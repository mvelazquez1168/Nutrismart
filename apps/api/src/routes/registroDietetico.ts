/**
 * Registro dietético estructurado — R40.
 *
 * Recordatorio de 24 horas y consumo usual comparten tabla y forma: seis
 * tiempos de comida fijos con alimentos en texto libre. Un registro por
 * (consulta, tipo).
 *
 * La columna «Alimentos consumidos» se manda a Claude (método ADA) para
 * estimar kcal/CHO/Prot/Grasas por tiempo de comida; el resultado se
 * cachea en la fila para no repetir la llamada mientras el texto no
 * cambie. Los campos `ai_*` SOLO los escribe el endpoint de análisis: el
 * upsert los preserva o los limpia según si el texto cambió.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { llamarClaude, IaNoDisponibleError } from '../ia/cliente.js'

/** Los seis tiempos fijos, en orden, con su etiqueta para el prompt. */
const TIEMPOS = [
  { clave: 'desayuno', etiqueta: 'Desayuno' },
  { clave: 'merienda_manana', etiqueta: 'Merienda Mañana' },
  { clave: 'almuerzo', etiqueta: 'Almuerzo' },
  { clave: 'merienda_tarde', etiqueta: 'Merienda tarde' },
  { clave: 'cena', etiqueta: 'Cena' },
  { clave: 'colacion_nocturna', etiqueta: 'Colación nocturna' },
] as const

const CLAVES = TIEMPOS.map((t) => t.clave) as readonly string[]
const TIPOS = ['recordatorio_24h', 'consumo_usual'] as const
type TipoRegistro = (typeof TIPOS)[number]

interface Fila {
  tiempo_comida: string
  hora: string | null
  alimentos_consumidos: string | null
  ai_kcal: number | null
  ai_cho_g: number | null
  ai_prot_g: number | null
  ai_grasas_g: number | null
  ai_calculado_en: string | null
  /**
   * kcal corregido a mano por el profesional — R41.
   *
   * Vive APARTE de `ai_kcal` en vez de pisarlo: así se puede volver
   * atrás. Vaciar el campo devuelve el número de la IA, que sigue
   * intacto, y se ve cuánto se corrigió respecto a lo estimado.
   *
   * null = vale el de la IA. La cuenta efectiva es `kcal_manual ?? ai_kcal`.
   */
  kcal_manual: number | null
}

const HORA_RE = /^\d{2}:\d{2}$/

/** Tope de sensatez para el kcal escrito a mano. Un tiempo de comida, no un día. */
const KCAL_MAX = 20_000

function filaVacia(clave: string): Fila {
  return {
    tiempo_comida: clave,
    hora: null,
    alimentos_consumidos: null,
    ai_kcal: null,
    ai_cho_g: null,
    ai_prot_g: null,
    ai_grasas_g: null,
    ai_calculado_en: null,
    kcal_manual: null,
  }
}

/**
 * Totales del día.
 *
 * Las kcal cuentan la corrección del profesional cuando la hay: el total
 * tiene que ser el mismo número que se ve sumado en la columna, o la
 * tabla y su pie dicen cosas distintas. Los macros son los de la IA —no
 * hay corrección manual para ellos— y por eso una fila con solo kcal a
 * mano suma calorías y no suma gramos.
 */
function totales(filas: Fila[]) {
  const t = { total_kcal: 0, total_cho_g: 0, total_prot_g: 0, total_grasas_g: 0 }
  for (const f of filas) {
    const kcal = f.kcal_manual ?? f.ai_kcal
    if (kcal === null) continue
    t.total_kcal += kcal
    t.total_cho_g += f.ai_cho_g ?? 0
    t.total_prot_g += f.ai_prot_g ?? 0
    t.total_grasas_g += f.ai_grasas_g ?? 0
  }
  const r = (n: number) => Math.round(n * 100) / 100
  return {
    total_kcal: r(t.total_kcal),
    total_cho_g: r(t.total_cho_g),
    total_prot_g: r(t.total_prot_g),
    total_grasas_g: r(t.total_grasas_g),
  }
}

interface FilaRow {
  observaciones: string | null
  filas: Fila[]
  total_kcal: number | null
  total_cho_g: number | null
  total_prot_g: number | null
  total_grasas_g: number | null
}

function respuesta(r: FilaRow | null) {
  // Siempre devuelve las seis filas en orden, aunque el registro no exista.
  const guardadas = new Map((r?.filas ?? []).map((f) => [f.tiempo_comida, f]))
  // Sobre la fila vacía, para que los registros guardados antes de que
  // existiera `kcal_manual` (R41) lleguen al cliente con la clave puesta
  // en null en vez de ausente.
  const filas = TIEMPOS.map((t) => {
    const f = guardadas.get(t.clave)
    return f ? { ...filaVacia(t.clave), ...f } : filaVacia(t.clave)
  })
  return {
    observaciones: r?.observaciones ?? null,
    totalKcal: r?.total_kcal ?? null,
    totalChoG: r?.total_cho_g ?? null,
    totalProtG: r?.total_prot_g ?? null,
    totalGrasasG: r?.total_grasas_g ?? null,
    filas,
  }
}

/**
 * Mensaje por tipo de fallo de la IA — R46.
 *
 * El profesional tiene que poder distinguir «esto se arregla esperando» de
 * «esto lo tiene que arreglar quien administra el servidor». Un único
 * «no está disponible ahora mismo» para los cuatro casos manda a esperar a
 * quien nunca va a ver funcionar el botón porque falta la clave.
 *
 * Todos cierran recordando que el kcal se puede escribir a mano: la regla
 * de oro del proyecto es que la falta de IA no bloquee el trabajo clínico.
 */
const MENSAJE_FALLO_IA: Record<string, string> = {
  sin_configurar:
    'El análisis con IA no está configurado en este servidor (falta ANTHROPIC_API_KEY). No es un fallo pasajero: avisa a quien administra la instalación. Puedes escribir las kcal a mano mientras tanto.',
  credencial_invalida:
    'La clave de la IA no es válida o fue revocada. Avisa a quien administra la instalación; esperando no se arregla. Puedes escribir las kcal a mano mientras tanto.',
  limite_de_uso:
    'Se agotó el límite de uso de la IA. Vuelve a intentarlo en unos minutos, o escribe las kcal a mano.',
  tiempo_agotado:
    'La IA tardó demasiado en responder. Vuelve a intentarlo, o escribe las kcal a mano.',
  sin_conexion:
    'El servidor no pudo contactar con el servicio de IA. Revisa su salida a internet, o escribe las kcal a mano.',
  sin_contenido:
    'La IA no devolvió un análisis para este texto. Prueba a detallar más los alimentos, o escribe las kcal a mano.',
}

const FALLO_IA_GENERICO =
  'El servicio de análisis nutricional no está disponible ahora mismo. Puedes escribir las kcal a mano.'

/**
 * 504 solo para el tiempo agotado; 503 para el resto.
 *
 * `credencial_invalida` y `sin_configurar` no son 5xx del todo honestos
 * —el servidor está bien, le falta configuración— pero sí son «el cliente
 * no puede hacer nada»: 503 con el motivo en el cuerpo es lo que el
 * frontend necesita para explicarlo.
 */
function estadoDeFalloIa(tipo: string): number {
  return tipo === 'tiempo_agotado' ? 504 : 503
}

function sinProfesional() {
  return { error: 'profesional_no_encontrado', message: 'Tu usuario no tiene un profesional asociado en esta clínica' }
}
function noEncontradaConsulta() {
  return { error: 'consulta_no_encontrada', message: 'No se encontró la consulta' }
}

export async function registerRegistroDieteticoRoutes(app: FastifyInstance): Promise<void> {
  async function cargarConsulta(consultaId: string, pacienteId: string, tenantId: string, restringirA: string | null) {
    if (!esUuid(consultaId) || !esUuid(pacienteId)) return null
    const { rows } = await pool.query<{ id: string }>(
      `select c.id
         from consulta c join paciente p on p.id = c.paciente_id
        where c.id = $1 and c.paciente_id = $2 and c.clinica_id = $3
          and ($4::uuid is null or p.nutricionista_id = $4)`,
      [consultaId, pacienteId, tenantId, restringirA],
    )
    return rows[0] ?? null
  }

  async function leerRegistro(consultaId: string, tenantId: string, tipo: TipoRegistro): Promise<FilaRow | null> {
    const { rows } = await pool.query(
      `select observaciones, filas, total_kcal, total_cho_g, total_prot_g, total_grasas_g
         from registro_dietetico
        where consulta_id = $1 and clinica_id = $2 and tipo = $3`,
      [consultaId, tenantId, tipo],
    )
    const f = rows[0]
    if (!f) return null
    return {
      observaciones: (f['observaciones'] as string | null) ?? null,
      filas: (f['filas'] as Fila[]) ?? [],
      total_kcal: f['total_kcal'] === null ? null : Number(f['total_kcal']),
      total_cho_g: f['total_cho_g'] === null ? null : Number(f['total_cho_g']),
      total_prot_g: f['total_prot_g'] === null ? null : Number(f['total_prot_g']),
      total_grasas_g: f['total_grasas_g'] === null ? null : Number(f['total_grasas_g']),
    }
  }

  async function guardar(consultaId: string, tenantId: string, tipo: TipoRegistro, observaciones: string | null, filas: Fila[]) {
    const t = totales(filas)
    await pool.query(
      `insert into registro_dietetico
         (clinica_id, consulta_id, tipo, observaciones, filas, total_kcal, total_cho_g, total_prot_g, total_grasas_g)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
       on conflict (consulta_id, tipo) do update set
         observaciones = excluded.observaciones,
         filas = excluded.filas,
         total_kcal = excluded.total_kcal,
         total_cho_g = excluded.total_cho_g,
         total_prot_g = excluded.total_prot_g,
         total_grasas_g = excluded.total_grasas_g`,
      [tenantId, consultaId, tipo, observaciones, JSON.stringify(filas), t.total_kcal, t.total_cho_g, t.total_prot_g, t.total_grasas_g],
    )
  }

  /** Resuelve alcance + consulta, o envía el error y devuelve null. */
  async function contexto(request: { auth: { tenantId: string; sub: string; roles: string[] } }, id: string, consultaId: string, tipoRaw: string, reply: import('fastify').FastifyReply) {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) {
      reply.code(403).send(sinProfesional())
      return null
    }
    if (!TIPOS.includes(tipoRaw as TipoRegistro)) {
      reply.code(404).send({ error: 'tipo_invalido', message: 'Tipo de registro dietético no válido' })
      return null
    }
    const consulta = await cargarConsulta(consultaId, id, tenantId, alcance.restringirA)
    if (!consulta) {
      reply.code(404).send(noEncontradaConsulta())
      return null
    }
    return { tenantId, tipo: tipoRaw as TipoRegistro, consultaId: consulta.id, profesionalId: alcance.profesionalId }
  }

  const BASE = '/api/pacientes/:id/consultas/:consultaId/registro-dietetico/:tipo'

  /* ---- GET ---- */
  app.get<{ Params: { id: string; consultaId: string; tipo: string } }>(
    BASE,
    { preHandler: requireAuth },
    async (request, reply) => {
      const ctx = await contexto(request, request.params.id, request.params.consultaId, request.params.tipo, reply)
      if (!ctx) return
      const reg = await leerRegistro(ctx.consultaId, ctx.tenantId, ctx.tipo)
      return reply.send(respuesta(reg))
    },
  )

  /* ---- PUT (upsert) ---- */
  app.put<{ Params: { id: string; consultaId: string; tipo: string } }>(
    BASE,
    { preHandler: requireAuth },
    async (request, reply) => {
      const ctx = await contexto(request, request.params.id, request.params.consultaId, request.params.tipo, reply)
      if (!ctx) return

      const body = (request.body ?? {}) as Record<string, unknown>
      const observaciones =
        typeof body['observaciones'] === 'string' && body['observaciones'].trim() !== ''
          ? (body['observaciones'] as string).trim()
          : null

      const entrantes = new Map<
        string,
        { hora: string | null; alimentos: string | null; kcalManual: number | null }
      >()
      if (Array.isArray(body['filas'])) {
        for (const cruda of body['filas'] as unknown[]) {
          const o = (cruda ?? {}) as Record<string, unknown>
          const tc = o['tiempo_comida']
          if (typeof tc !== 'string' || !CLAVES.includes(tc)) continue
          const horaBruta = o['hora']
          const hora = typeof horaBruta === 'string' && HORA_RE.test(horaBruta) ? horaBruta : null
          const alimentos =
            typeof o['alimentos_consumidos'] === 'string' && o['alimentos_consumidos'].trim() !== ''
              ? (o['alimentos_consumidos'] as string).trim()
              : null
          // Fuera de rango se descarta en silencio y la fila vuelve al
          // valor de la IA: rechazar el guardado entero por un dígito de
          // más perdería el texto que se acaba de escribir.
          const kcalBruto = Number(o['kcal_manual'])
          const kcalManual =
            o['kcal_manual'] === null ||
            o['kcal_manual'] === undefined ||
            o['kcal_manual'] === '' ||
            !Number.isFinite(kcalBruto) ||
            kcalBruto < 0 ||
            kcalBruto > KCAL_MAX
              ? null
              : Math.round(kcalBruto * 10) / 10
          entrantes.set(tc, { hora, alimentos, kcalManual })
        }
      }

      const previas = new Map((await leerRegistro(ctx.consultaId, ctx.tenantId, ctx.tipo))?.filas.map((f) => [f.tiempo_comida, f]) ?? [])

      // Canon de seis filas. Los ai_* se preservan si el texto no cambió;
      // si cambió (o es nuevo), quedan en null esperando nuevo análisis.
      const filas: Fila[] = TIEMPOS.map((t) => {
        const entra = entrantes.get(t.clave)
        const previa = previas.get(t.clave)
        const alimentos = entra ? entra.alimentos : (previa?.alimentos_consumidos ?? null)
        const hora = entra ? entra.hora : (previa?.hora ?? null)
        const textoCambio = previa !== undefined && previa.alimentos_consumidos !== alimentos
        const conservaIa = previa && !textoCambio && previa.ai_calculado_en !== null
        return {
          tiempo_comida: t.clave,
          hora,
          alimentos_consumidos: alimentos,
          ai_kcal: conservaIa ? previa!.ai_kcal : null,
          ai_cho_g: conservaIa ? previa!.ai_cho_g : null,
          ai_prot_g: conservaIa ? previa!.ai_prot_g : null,
          ai_grasas_g: conservaIa ? previa!.ai_grasas_g : null,
          ai_calculado_en: conservaIa ? previa!.ai_calculado_en : null,
          // La corrección manual es sobre un texto concreto: si el texto
          // cambia deja de valer, aunque no hubiera análisis de IA que
          // invalidar. Lo que no cambió conserva lo que mande el cliente,
          // o lo de antes si esta fila no venía en el cuerpo.
          kcal_manual: textoCambio
            ? null
            : entra
              ? entra.kcalManual
              : (previa?.kcal_manual ?? null),
        }
      })

      await guardar(ctx.consultaId, ctx.tenantId, ctx.tipo, observaciones, filas)
      const reg = await leerRegistro(ctx.consultaId, ctx.tenantId, ctx.tipo)
      return reply.send(respuesta(reg))
    },
  )

  /* ---- POST /analizar-ia ---- */
  app.post<{ Params: { id: string; consultaId: string; tipo: string } }>(
    `${BASE}/analizar-ia`,
    { preHandler: requireAuth },
    async (request, reply) => {
      const ctx = await contexto(request, request.params.id, request.params.consultaId, request.params.tipo, reply)
      if (!ctx) return

      const body = (request.body ?? {}) as Record<string, unknown>
      const tc = body['tiempo_comida']
      if (typeof tc !== 'string' || !CLAVES.includes(tc)) {
        return reply.code(400).send({ error: 'tiempo_invalido', message: 'tiempo_comida no válido' })
      }

      const reg = await leerRegistro(ctx.consultaId, ctx.tenantId, ctx.tipo)
      const fila = reg?.filas.find((f) => f.tiempo_comida === tc)
      const texto = fila?.alimentos_consumidos ?? null
      if (!reg || !fila || !texto) {
        return reply.code(400).send({ error: 'sin_alimentos', message: 'No hay alimentos consumidos para analizar en este tiempo de comida' })
      }

      // Cache: ya analizado para el texto actual (el upsert borra ai_* al
      // cambiar el texto, así que un ai_calculado_en presente = vigente).
      if (fila.ai_calculado_en !== null && fila.ai_kcal !== null) {
        return reply.send(respuesta(reg))
      }

      const etiqueta = TIEMPOS.find((t) => t.clave === tc)?.etiqueta ?? tc
      const prompt = construirPrompt(etiqueta, texto)

      let parsed: { kcal: number; cho_g: number; prot_g: number; grasas_g: number }
      try {
        const salida = await analizarConReintento(prompt, {
          clinicaId: ctx.tenantId,
          profesionalId: ctx.profesionalId,
          funcion: 'analisis_dietetico',
        })
        parsed = parsearJson(salida)
      } catch (e) {
        if (e instanceof IaNoDisponibleError) {
          // El motivo viaja en el cuerpo y el mensaje lo nombra. Antes los
          // cuatro fallos colapsaban en «no está disponible ahora mismo», y
          // eso hacía indistinguible una clave que falta —que no se arregla
          // esperando— de una saturación que sí (R46).
          request.log?.error?.({ tipo: e.tipo }, '[analisis-dietetico] IA no disponible')
          return reply.code(estadoDeFalloIa(e.tipo)).send({
            error: e.tipo,
            tipo: e.tipo,
            message: MENSAJE_FALLO_IA[e.tipo] ?? FALLO_IA_GENERICO,
          })
        }
        // JSON no parseable u otra cosa.
        request.log?.error?.({ err: e }, '[analisis-dietetico] respuesta no interpretable')
        return reply.code(502).send({ error: 'respuesta_invalida', tipo: 'respuesta_invalida', message: 'No se pudo interpretar la respuesta del modelo de análisis nutricional. Vuelve a intentarlo; si persiste, escribe las kcal a mano.' })
      }

      if (parsed.kcal > 5000) {
        console.warn('[analisis-dietetico] kcal irrealmente alto (%d) para "%s"; se persiste igual', parsed.kcal, texto)
      }

      const filas = reg.filas.map((f) =>
        f.tiempo_comida === tc
          ? {
              ...f,
              ai_kcal: Math.round(parsed.kcal * 10) / 10,
              ai_cho_g: Math.round(parsed.cho_g * 10) / 10,
              ai_prot_g: Math.round(parsed.prot_g * 10) / 10,
              ai_grasas_g: Math.round(parsed.grasas_g * 10) / 10,
              ai_calculado_en: new Date().toISOString(),
            }
          : f,
      )

      await guardar(ctx.consultaId, ctx.tenantId, ctx.tipo, reg.observaciones, filas)
      const actualizado = await leerRegistro(ctx.consultaId, ctx.tenantId, ctx.tipo)
      return reply.send(respuesta(actualizado))
    },
  )
}

/* ------------------------------------------------------------------ */
/* IA — método ADA                                                     */
/* ------------------------------------------------------------------ */

const SISTEMA_ADA = `Eres un asistente de nutrición clínica. Tu tarea es analizar el texto libre de alimentos consumidos en un tiempo de comida y estimar su composición nutricional usando las tablas de intercambio del Sistema ADA.

Valores nutricionales por intercambio ADA:
| Grupo | CHO (g) | Prot (g) | Grasas (g) | kcal |
|---|---|---|---|---|
| Leche descremada | 12 | 8 | 1 | 100 |
| Leche semidescremada | 12 | 8 | 5 | 120 |
| Leche entera | 12 | 8 | 8 | 160 |
| Vegetales | 5 | 2 | 0 | 25 |
| Frutas | 15 | 0 | 0 | 60 |
| Azúcares | 5 | 0 | 0 | 20 |
| Cereales | 15 | 3 | 1 | 80 |
| Carnes magras | 0 | 7 | 2 | 45 |
| Carnes semimagras | 0 | 7 | 5 | 75 |
| Carnes alta grasa | 0 | 7 | 8 | 100 |
| Grasas | 0 | 0 | 5 | 45 |

Instrucciones:
1. Identifica cada alimento mencionado y asígnalo al grupo de intercambio ADA más apropiado.
2. Estima la cantidad de intercambios según las porciones mencionadas (o porciones estándar si no se especifican cantidades).
3. Multiplica intercambios × valores del grupo para obtener kcal, CHO, Prot y Grasas de cada alimento.
4. Suma todos los alimentos para dar el total del tiempo de comida.
5. Responde ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown.

Formato de respuesta JSON:
{ "kcal": 0.0, "cho_g": 0.0, "prot_g": 0.0, "grasas_g": 0.0 }`

export function construirPrompt(etiqueta: string, texto: string): string {
  return `${SISTEMA_ADA}\n\nTiempo de comida: ${etiqueta}\nAlimentos consumidos: ${texto}\n\nAnaliza estos alimentos y devuelve el JSON con la composición nutricional.`
}

/** Extrae el JSON de la respuesta (tolera cercas de markdown) y valida. */
export function parsearJson(texto: string): { kcal: number; cho_g: number; prot_g: number; grasas_g: number } {
  let limpio = texto.trim()
  const cerca = limpio.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (cerca?.[1]) limpio = cerca[1].trim()
  else {
    const inicio = limpio.indexOf('{')
    const fin = limpio.lastIndexOf('}')
    if (inicio !== -1 && fin !== -1) limpio = limpio.slice(inicio, fin + 1)
  }
  const obj = JSON.parse(limpio) as Record<string, unknown>
  const n = (v: unknown) => {
    const x = Number(v)
    return Number.isFinite(x) && x >= 0 ? x : 0
  }
  return { kcal: n(obj['kcal']), cho_g: n(obj['cho_g']), prot_g: n(obj['prot_g']), grasas_g: n(obj['grasas_g']) }
}

/** Un reintento tras 2 s si el modelo devuelve límite de uso (429). */
async function analizarConReintento(prompt: string, ctx: { clinicaId: string; profesionalId: string | null; funcion: 'analisis_dietetico' }): Promise<string> {
  try {
    return (await llamarClaude(prompt, ctx)).texto
  } catch (e) {
    if (e instanceof IaNoDisponibleError && e.tipo === 'limite_de_uso') {
      await new Promise((r) => setTimeout(r, 2000))
      return (await llamarClaude(prompt, ctx)).texto
    }
    throw e
  }
}
