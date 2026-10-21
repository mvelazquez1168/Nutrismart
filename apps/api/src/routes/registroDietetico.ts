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
import {
  leerGrupos,
  resolverAlimento,
  sumarMacros,
  type AlimentoResuelto,
  type GrupoIntercambio,
  type Macros,
} from '../dietetico/intercambios.js'
import {
  construirPromptIdentificacion,
  leerCatalogo,
  parsearIdentificacion,
  type AlimentoIdentificado,
  type EntradaCatalogo,
} from '../dietetico/identificacion.js'
import {
  calcular,
  cotejarReferencia,
  MENSAJE_INCALCULABLE,
  type Calculo,
} from '../dietetico/calculo.js'
import { textoAAnalizar } from '../dietetico/parentesis.js'

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
   * Los cuatro valores corregidos a mano por el profesional — R41, R50.
   *
   * Viven APARTE de los `ai_*` en vez de pisarlos: así se puede volver
   * atrás. Vaciar una casilla devuelve el número calculado, que sigue
   * intacto, y se ve cuánto se corrigió respecto a lo estimado.
   *
   * null = vale el calculado. La cuenta efectiva la hace `efectivos`.
   *
   * **Los tres macros se corrigen desde R50, y antes no.** El motivo que
   * había para dejarlos fijos —«corregirlos uno a uno sin recalcular el
   * conjunto daría un reparto que no cuadra»— se cae cuando el alimento
   * no está en la lista de intercambios: ahí no hay ningún reparto que
   * respetar, hay cuatro casillas vacías y un profesional que sabe lo que
   * comió el paciente. Que las kcal se pudieran escribir y los gramos no
   * dejaba la fila a medias.
   */
  kcal_manual: number | null
  cho_g_manual: number | null
  prot_g_manual: number | null
  grasas_g_manual: number | null
  /**
   * Los alimentos que el texto nombraba y que NO estan en la lista de
   * intercambios — R48.
   *
   * Se persiste y no solo se devuelve en la respuesta del analisis: al volver a
   * abrir la consulta manana, el aviso tiene que seguir ahi. Un aviso que se
   * pierde al recargar es un aviso que solo ve quien estaba mirando.
   *
   * null = nunca se analizo. Lista vacia = se analizo y se encontro todo.
   */
  ai_no_encontrado: string[] | null
}

const HORA_RE = /^\d{2}:\d{2}$/

/** Tope de sensatez para el kcal escrito a mano. Un tiempo de comida, no un día. */
const KCAL_MAX = 20_000

/** Tope para los gramos de un macro en un tiempo de comida. */
const GRAMOS_MAX = 2_000

/**
 * Un valor corregido a mano, saneado.
 *
 * Fuera de rango se descarta **en silencio** y la casilla vuelve al valor
 * calculado: rechazar el guardado entero por un dígito de más perdería el
 * texto que el profesional acaba de escribir, que es lo irreemplazable de
 * esta pantalla.
 */
function manualDe(bruto: unknown, tope: number): number | null {
  if (bruto === null || bruto === undefined || bruto === '') return null
  const n = Number(bruto)
  if (!Number.isFinite(n) || n < 0 || n > tope) return null
  return Math.round(n * 10) / 10
}

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
    cho_g_manual: null,
    prot_g_manual: null,
    grasas_g_manual: null,
    ai_no_encontrado: null,
  }
}

/**
 * Los cuatro valores que VALEN para una fila.
 *
 * La corrección del profesional manda sobre lo calculado, y lo calculado
 * no se pisa nunca: vaciar la casilla devuelve el número de la lista de
 * intercambios.
 */
function efectivos(f: Fila) {
  return {
    kcal: f.kcal_manual ?? f.ai_kcal,
    cho_g: f.cho_g_manual ?? f.ai_cho_g,
    prot_g: f.prot_g_manual ?? f.ai_prot_g,
    grasas_g: f.grasas_g_manual ?? f.ai_grasas_g,
  }
}

/**
 * Totales del día.
 *
 * **Los cuatro se suman por separado, y cada uno cuenta su corrección.**
 * Antes la fila entera se descartaba si no tenía kcal, de modo que unos
 * gramos escritos a mano sin kcal no sumaban en ningún sitio. Ahora cada
 * columna suma lo suyo: el pie de la tabla tiene que dar el mismo número
 * que da sumar la columna a mano, o la tabla y su pie se contradicen.
 */
function totales(filas: Fila[]) {
  const t = { total_kcal: 0, total_cho_g: 0, total_prot_g: 0, total_grasas_g: 0 }
  for (const f of filas) {
    const e = efectivos(f)
    t.total_kcal += e.kcal ?? 0
    t.total_cho_g += e.cho_g ?? 0
    t.total_prot_g += e.prot_g ?? 0
    t.total_grasas_g += e.grasas_g ?? 0
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

/**
 * Traduce un fallo de la fase de IA a su respuesta, con el motivo en el cuerpo.
 *
 * Lo comparten `/calcular` y `/analizar-ia` porque el profesional necesita la
 * misma distincion en las dos: «esto se arregla esperando» contra «esto lo
 * arregla quien administra el servidor» (R46). Lo que no es un fallo de la IA
 * —un JSON que no se puede leer— sale como 502 y no como 503: el proveedor
 * respondio, lo que vino mal es la respuesta.
 */
function responderFalloIa(
  e: unknown,
  request: { log?: { error?: (...a: unknown[]) => void } },
  reply: import('fastify').FastifyReply,
  etiqueta: string,
) {
  if (e instanceof IaNoDisponibleError) {
    request.log?.error?.({ tipo: e.tipo }, `[${etiqueta}] IA no disponible`)
    return reply.code(estadoDeFalloIa(e.tipo)).send({
      error: e.tipo,
      tipo: e.tipo,
      message: MENSAJE_FALLO_IA[e.tipo] ?? FALLO_IA_GENERICO,
    })
  }
  request.log?.error?.({ err: e }, `[${etiqueta}] respuesta no interpretable`)
  return reply.code(502).send({
    error: 'respuesta_invalida',
    tipo: 'respuesta_invalida',
    message:
      'No se pudo interpretar la respuesta del modelo de análisis nutricional. Vuelve a intentarlo; si persiste, escribe las kcal a mano.',
  })
}

/**
 * El texto que va a la fase 1, venga en la forma nueva o en la anterior.
 *
 * Devuelve null cuando no hay nada que identificar. `alimento` + `cantidad` se
 * unen en ese orden —«250 ml» + «leche descremada»— porque es como se escribe y
 * como el modelo lo lee mejor.
 */
function textoAIdentificar(body: Record<string, unknown>): string | null {
  const libre = typeof body['texto'] === 'string' ? body['texto'].trim() : ''
  if (libre !== '') return libre

  const alimento = typeof body['alimento'] === 'string' ? body['alimento'].trim() : ''
  if (alimento === '') return null
  const cantidad = typeof body['cantidad'] === 'string' ? body['cantidad'].trim() : ''
  return cantidad === '' ? alimento : `${cantidad} de ${alimento}`
}

/** Un alimento identificado, con su fila de la base y su calculo. */
interface Resuelto {
  identificado: AlimentoIdentificado
  entrada: EntradaCatalogo | null
  calculo: Calculo | null
}

/**
 * Pasa de la fase 1 a la fase 2: resuelve el indice a su fila y calcula.
 *
 * Un `equivalencia_id` que no esta en el catalogo se trata como no encontrado y
 * se registra: significa que el modelo devolvio un numero que no se le dio, y
 * eso hay que verlo en los registros aunque la respuesta al profesional sea la
 * misma que si no hubiera encontrado nada.
 */
function resolver(
  identificado: AlimentoIdentificado,
  porIndice: Map<number, EntradaCatalogo>,
  grupos: Map<string, GrupoIntercambio>,
  request: { log?: { warn?: (...a: unknown[]) => void } },
): Resuelto {
  if (!identificado.encontrado || identificado.equivalencia_id === null) {
    return { identificado, entrada: null, calculo: null }
  }

  const entrada = porIndice.get(identificado.equivalencia_id)
  if (!entrada) {
    request.log?.warn?.(
      { equivalencia_id: identificado.equivalencia_id, alimento: identificado.descripcion_usuario },
      '[calculo-dietetico] el modelo devolvio un numero de equivalencia que no existe',
    )
    return { identificado, entrada: null, calculo: null }
  }

  const divergencias = cotejarReferencia(identificado, entrada)
  if (divergencias.length > 0) {
    request.log?.warn?.(
      { divergencias, alimento: identificado.descripcion_usuario },
      '[calculo-dietetico] lo que el modelo dijo de la fila no coincide con la fila',
    )
  }

  return { identificado, entrada, calculo: calcular(identificado, entrada, grupos) }
}

/**
 * La forma que ve el frontend.
 *
 * Los campos de la equivalencia salen de `entrada` —la base— y no del objeto
 * del modelo: lo que el modelo dijo ya se cotejo y se registro, y lo que viaja
 * a la pantalla tiene que ser lo mismo que entro en la multiplicacion. Dos
 * origenes distintos para el numero mostrado y el numero calculado es como se
 * construye una pantalla que miente sin que nadie mienta.
 */
function aRespuesta(r: Resuelto) {
  const { identificado: i, entrada, calculo } = r
  const ok = calculo?.estado === 'ok' ? calculo : null
  const fallo =
    calculo !== null && (calculo.estado === 'unidades_incompatibles' || calculo.estado === 'porciones_absurdas' || calculo.estado === 'cantidad_invalida')

  if (calculo?.estado === 'porciones_absurdas') {
    // Se registra con el numero que se rechazo: es el dato que permite decidir
    // si el tope de 15 esta bien puesto o esta rechazando calculos buenos.
    console.warn(
      '[calculo-dietetico] porciones rechazadas por absurdas: %s -> %d porciones de "%s" (%s)',
      i.descripcion_usuario,
      calculo.porciones,
      entrada?.alimento,
      entrada?.cantidadDescripcion,
    )
  }

  return {
    descripcion_usuario: i.descripcion_usuario,
    cantidad_usuario: i.cantidad_usuario,
    unidad_usuario: i.unidad_usuario,
    encontrado: entrada !== null,
    no_encontrado: entrada === null,
    alimento_encontrado: entrada?.alimento ?? null,
    equivalencia_id: entrada?.indice ?? null,
    porcion_referencia: entrada?.cantidadDescripcion ?? null,
    grupo: entrada?.subtipo ?? null,
    grupos:
      entrada?.porciones.map((p) => ({
        grupo: p.grupo_id,
        porciones_por_referencia: Number(p.cantidad_decimal),
      })) ?? [],
    porciones: ok?.porciones ?? null,
    porciones_supuestas: ok?.porcionesSupuestas ?? false,
    nota: i.nota,
    error: fallo ? MENSAJE_INCALCULABLE : null,
    cho_g: ok?.macros.cho_g ?? null,
    chon_g: ok?.macros.chon_g ?? null,
    grasa_g: ok?.macros.grasa_g ?? null,
    kcal: ok?.macros.kcal ?? null,
  }
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

      interface Entrante {
        hora: string | null
        alimentos: string | null
        kcalManual: number | null
        choManual: number | null
        protManual: number | null
        grasasManual: number | null
      }
      const entrantes = new Map<string, Entrante>()
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
          entrantes.set(tc, {
            hora,
            alimentos,
            kcalManual: manualDe(o['kcal_manual'], KCAL_MAX),
            choManual: manualDe(o['cho_g_manual'], GRAMOS_MAX),
            protManual: manualDe(o['prot_g_manual'], GRAMOS_MAX),
            grasasManual: manualDe(o['grasas_g_manual'], GRAMOS_MAX),
          })
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
          // Mismo criterio que el resto de los `ai_*`: el aviso de «no
          // encontrado» es sobre un texto concreto, y si el texto cambio deja
          // de valer. Conservarlo mostraria un aviso sobre un alimento que ya
          // no esta escrito.
          ai_no_encontrado: conservaIa ? (previa!.ai_no_encontrado ?? null) : null,
          /*
           * **Lo que manda el cliente vale, incluso si el texto cambió.**
           *
           * Antes esto era `textoCambio ? null : …`, y anulaba también las
           * correcciones que venían EN LA MISMA peticion que el texto
           * nuevo. Es el caso normal: el profesional escribe el alimento,
           * escribe sus cuatro valores porque no está en la lista de
           * intercambios, pulsa Guardar — y los cuatro se perdían. Las
           * correcciones del cuerpo son sobre el texto del cuerpo; llegan
           * juntas y describen lo mismo.
           *
           * `textoCambio` sigue anulando lo que venía de ANTES cuando esta
           * fila no viaja en el cuerpo: eso sí es una corrección sobre un
           * texto que ya no está escrito. Y cuando la fila sí viaja, quien
           * borra las casillas al cambiar el texto es la pantalla, donde
           * se ve: ver `editar` en TablaDietetica.tsx.
           */
          kcal_manual: entra ? entra.kcalManual : textoCambio ? null : (previa?.kcal_manual ?? null),
          cho_g_manual: entra ? entra.choManual : textoCambio ? null : (previa?.cho_g_manual ?? null),
          prot_g_manual: entra
            ? entra.protManual
            : textoCambio
              ? null
              : (previa?.prot_g_manual ?? null),
          grasas_g_manual: entra
            ? entra.grasasManual
            : textoCambio
              ? null
              : (previa?.grasas_g_manual ?? null),
        }
      })

      await guardar(ctx.consultaId, ctx.tenantId, ctx.tipo, observaciones, filas)
      const reg = await leerRegistro(ctx.consultaId, ctx.tenantId, ctx.tipo)
      return reply.send(respuesta(reg))
    },
  )

  /* ---- POST /calcular ---- */
  /**
   * **Dos fases: el modelo identifica, el servidor calcula.**
   *
   * ## Que problema resuelve partirlo en dos
   *
   * Antes esta ruta buscaba el alimento con trigramas en Postgres y no llamaba
   * a ningun modelo. Encontraba «arroz blanco» escribiendo «arroz blanco», y no
   * lo encontraba escribiendo «arroz cocido»: comparar cadenas no sabe que son
   * el mismo alimento. Eso es exactamente lo que un modelo hace bien.
   *
   * Pero un modelo que encuentra el alimento tambien querra multiplicarlo, y
   * entonces el numero sale de una cadena de texto y no se puede comprobar. De
   * ahi las dos fases, y la frontera entre ellas:
   *
   *   FASE 1 (`dietetico/identificacion.ts`) — el modelo recibe el catalogo
   *   numerado y devuelve QUE fila es y QUE cantidad escribio el profesional.
   *   No ve los valores nutricionales de los grupos, asi que no puede
   *   multiplicar nada aunque se lo propusiera.
   *
   *   FASE 2 (`dietetico/calculo.ts` + `dietetico/unidades.ts`) — el servidor
   *   convierte las dos cantidades a una base comun, comprueba que se puedan
   *   comparar, divide, y multiplica por las filas de `grupo_intercambio`.
   *
   * ## Lo que esta ruta ahora SI puede hacer y antes no
   *
   * Fallar por el proveedor de IA y consumir saldo. Se trata como en
   * `/analizar-ia`: el motivo viaja en el cuerpo con su mensaje, y el
   * profesional escribe los valores a mano. La regla de oro se mantiene —la
   * falta de IA no bloquea el trabajo clinico—, pero conviene saber que esta
   * ruta dejo de ser gratuita.
   *
   * ## Los tres finales posibles por alimento
   *
   *   `encontrado: false`     el catalogo no lo tiene. No se inventa un numero.
   *   `error` con mensaje     se encontro, pero la cantidad escrita no se puede
   *                           comparar con la unidad de la fila, o el resultado
   *                           era absurdo. Ver `MENSAJE_INCALCULABLE`.
   *   porciones y macros      el calculo, con `porciones_supuestas` cuando no
   *                           habia cantidad que dividir.
   *
   * El `error` de nivel superior aparece cuando NINGUN alimento dio numeros: es
   * el caso que el requerimiento pide devolver al frontend tal cual.
   *
   * ## Dos modos de llamada, y por que hay dos
   *
   *   **Modo fila** — el cuerpo trae `tiempo_comida`. Es el que usa la tabla de
   *   Consumo Usual y Recordatorio 24 h. Lee el texto GUARDADO de esa fila,
   *   calcula, **persiste** los `ai_*` y el aviso de lo no encontrado, y
   *   devuelve el registro completo —las seis filas— mas el detalle por
   *   alimento. Es la forma que reemplaza a `/analizar-ia` en la pantalla.
   *
   *   **Modo texto** — el cuerpo trae `texto` (o `alimento` + `cantidad`). No
   *   toca la base: calcula y devuelve. Sirve para un calculo suelto, fuera de
   *   una fila.
   *
   * El modo fila existe porque sin el la pantalla no puede usar esta ruta. Los
   * `ai_*` los escribe **solo** el servidor —asi esta documentado arriba en
   * `Fila`— de modo que un cliente que recibiera unos totales no tendria donde
   * guardarlos: escribirlos como `*_manual` los marcaria como correcciones del
   * profesional, que es precisamente lo que no son. Y sin persistir, el analisis
   * se perderia al recargar la consulta, junto con el aviso de R48.
   */
  app.post<{ Params: { id: string; consultaId: string; tipo: string } }>(
    `${BASE}/calcular`,
    { preHandler: requireAuth },
    async (request, reply) => {
      const ctx = await contexto(request, request.params.id, request.params.consultaId, request.params.tipo, reply)
      if (!ctx) return

      const body = (request.body ?? {}) as Record<string, unknown>

      const tc = body['tiempo_comida']
      const modoFila = typeof tc === 'string' && CLAVES.includes(tc)

      let texto: string | null
      let reg: FilaRow | null = null

      if (modoFila) {
        reg = await leerRegistro(ctx.consultaId, ctx.tenantId, ctx.tipo)
        const fila = reg?.filas.find((f) => f.tiempo_comida === tc)
        texto = fila?.alimentos_consumidos ?? null
        if (!reg || !fila || !texto) {
          return reply.code(400).send({
            error: 'sin_alimentos',
            message: 'No hay alimentos consumidos para analizar en este tiempo de comida',
          })
        }
        // Misma cache que `/analizar-ia`: el upsert borra los `ai_*` al cambiar
        // el texto, asi que un `ai_calculado_en` presente significa vigente. Sin
        // esto, cada pulsacion del boton paga el catalogo otra vez.
        if (fila.ai_calculado_en !== null && fila.ai_kcal !== null) {
          return reply.send(respuesta(reg))
        }
        /*
         * **Consumo Usual: solo lo que va entre parentesis** (R43).
         *
         * Lo escrito fuera es contexto clinico —horarios, quien cocina, con
         * que frecuencia— que el profesional necesita conservar y que la fase 1
         * no debe intentar emparejar con la lista de intercambios. El recorte
         * se hace aqui, antes del prompt, y no pidiendoselo al modelo: ver
         * `dietetico/parentesis.ts`. Un texto sin parentesis se analiza
         * completo, como siempre.
         */
        texto = textoAAnalizar(texto, ctx.tipo)
      } else {
        /*
         * `texto` es la forma libre: una frase con cantidad y alimento juntos,
         * que es lo que el profesional escribe y lo que la fase 1 sabe partir.
         * Se siguen aceptando `alimento` + `cantidad` por separado —la forma
         * anterior— uniendolos, porque separados pierden justo lo que el modelo
         * necesita para elegir bien: «250 ml» al lado de «leche descremada»
         * dice que la fila buscada mide en volumen.
         */
        texto = textoAIdentificar(body)
        if (texto === null) {
          return reply.code(400).send({ error: 'sin_alimento', message: 'Indica el alimento' })
        }
      }

      const [catalogo, grupos] = await Promise.all([
        leerCatalogo(ctx.tenantId),
        leerGrupos(ctx.tenantId),
      ])
      if (catalogo.length === 0) {
        return reply.code(503).send({
          error: 'catalogo_vacio',
          message:
            'No hay equivalencias de intercambio cargadas en este servidor. Avisa a quien administra la instalación; puedes escribir los valores a mano mientras tanto.',
        })
      }

      const porIndice = new Map(catalogo.map((e) => [e.indice, e]))
      const ia = {
        clinicaId: ctx.tenantId,
        profesionalId: ctx.profesionalId,
        funcion: 'identificacion_dietetica' as const,
      }

      let identificados: AlimentoIdentificado[]
      try {
        identificados = parsearIdentificacion(
          await analizarConReintento(construirPromptIdentificacion(texto, catalogo), ia),
        )
      } catch (e) {
        return responderFalloIa(e, request, reply, 'identificacion-dietetica')
      }

      let resueltos = identificados.map((i) => resolver(i, porIndice, grupos, request))

      /*
       * **La vuelta que pide el requerimiento.**
       *
       * Una unidad incomparable no es un fallo del profesional: es una fila mal
       * elegida. «250 ml de leche» contra una fila que mide en «1 unidad» no se
       * puede dividir, y lo que corresponde es volver a preguntar vetando esa
       * fila, no rendirse. Se hace UNA vez y solo con los alimentos que
       * fallaron: un reintento sin tope es una factura sin tope.
       */
      const aReintentar = resueltos.filter((r) => r.calculo?.estado === 'unidades_incompatibles')
      if (aReintentar.length > 0) {
        const excluidos = aReintentar.map((r) => r.identificado.equivalencia_id!).filter(Boolean)
        const textoReintento = aReintentar.map((r) => r.identificado.descripcion_usuario).join(', ')
        try {
          const segundos = parsearIdentificacion(
            await analizarConReintento(
              construirPromptIdentificacion(textoReintento, catalogo, excluidos),
              ia,
            ),
          )
          // Se empareja por descripcion y, si el modelo la reescribio, por
          // posicion. Un emparejamiento equivocado aqui pegaria el calculo de
          // un alimento al nombre de otro, asi que lo que no se empareja se
          // queda con su primer resultado — que ya esta marcado como fallido.
          aReintentar.forEach((previo, i) => {
            const segundo =
              segundos.find(
                (s) =>
                  s.descripcion_usuario.toLowerCase() ===
                  previo.identificado.descripcion_usuario.toLowerCase(),
              ) ?? segundos[i]
            if (!segundo) return
            const nuevo = resolver(segundo, porIndice, grupos, request)
            if (nuevo.calculo?.estado === 'ok') {
              resueltos = resueltos.map((r) => (r === previo ? nuevo : r))
            }
          })
        } catch (e) {
          // El reintento es una mejora, no un requisito: si la IA se cae en la
          // segunda vuelta se responde con lo de la primera, que ya trae su
          // mensaje de «no se pudo calcular».
          request.log?.warn?.({ err: e }, '[calculo-dietetico] el reintento de identificacion fallo')
        }
      }

      const alimentos = resueltos.map(aRespuesta)
      const conNumeros = resueltos.filter((r) => r.calculo?.estado === 'ok')
      const total = sumarMacros(conNumeros.map((r) => (r.calculo as { macros: Macros }).macros))

      /*
       * **El mensaje de «no se pudo calcular» es para un fallo de CALCULO, no
       * para un alimento que no esta en la lista.**
       *
       * Dice «la cantidad ingresada parece incompatible con la unidad del
       * alimento encontrado» y pide especificar mejor. Para «pizza con piña»
       * —que no esta en el catalogo— eso es un consejo equivocado: no hay
       * ninguna cantidad que lo arregle, y el profesional se quedaria probando
       * redacciones. Ese caso ya tiene su senal, que es `no_encontrado` y el ⚠
       * de la fila.
       *
       * Asi que el error de nivel superior pide las dos cosas: que nada haya
       * dado numeros Y que al menos un alimento se haya encontrado y fallado al
       * calcularse. Con un alimento calculado y otro fallido no aparece: el
       * total es parcial pero cierto, y el fallido lleva su propio `error`.
       */
      const huboFalloDeCalculo = alimentos.some((a) => a.error !== null)
      const errorGeneral = conNumeros.length === 0 && huboFalloDeCalculo ? MENSAJE_INCALCULABLE : null

      /*
       * Lo que va al aviso ⚠ de la fila.
       *
       * Entran los dos finales que no dieron numeros: el alimento que el
       * catalogo no tiene, y el que se encontro pero no se pudo calcular. Para
       * el profesional los dos significan lo mismo —ese alimento no aporto al
       * total, ajustalo a mano— y la fila tiene un solo aviso donde decirlo.
       */
      const sinNumeros = alimentos
        .filter((a) => a.no_encontrado || a.error !== null)
        .map((a) => a.descripcion_usuario)

      if (!modoFila) {
        return reply.send({
          texto,
          alimentos,
          total,
          error: errorGeneral,
          no_encontrado: alimentos.some((a) => a.no_encontrado),
        })
      }

      /*
       * **Modo fila: se persiste, con la misma regla que `/analizar-ia`.**
       *
       * Si no se calculo NINGUN alimento, los cuatro `ai_*` se quedan en null y
       * no se escribe un cero: un total de cero con el texto escrito se lee como
       * «estos alimentos no aportan nada», que es falso. Lo que si se guarda es
       * el aviso, junto con `ai_calculado_en` —la combinacion que dice «esto ya
       * se analizo y no dio numeros»—; `ai_kcal` sigue en null, asi que el boton
       * continua ofreciendo el calculo y la cache no se envenena.
       */
      const calculado = new Date().toISOString()
      const filas = reg!.filas.map((f) =>
        f.tiempo_comida !== tc
          ? f
          : conNumeros.length === 0
            ? { ...f, ai_calculado_en: calculado, ai_no_encontrado: sinNumeros }
            : {
                ...f,
                ai_kcal: total.kcal,
                ai_cho_g: total.cho_g,
                ai_prot_g: total.chon_g,
                ai_grasas_g: total.grasa_g,
                ai_calculado_en: calculado,
                ai_no_encontrado: sinNumeros,
              },
      )

      await guardar(ctx.consultaId, ctx.tenantId, ctx.tipo, reg!.observaciones, filas)
      const actualizado = await leerRegistro(ctx.consultaId, ctx.tenantId, ctx.tipo)

      /*
       * La respuesta ES el registro —las seis filas y las observaciones—, con el
       * detalle del calculo al lado. La pantalla hidrata su tabla con esto, igual
       * que hacia con `/analizar-ia`: cambiar la forma obligaria a la tabla a
       * saber de donde vino cada campo.
       */
      return reply.send({
        ...respuesta(actualizado),
        alimentos,
        total,
        error: errorGeneral,
        no_encontrado: sinNumeros.length > 0,
        alimentos_no_encontrados: sinNumeros,
      })
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
      // Misma convencion que `/calcular` (R43): en Consumo Usual solo se
      // analizan los alimentos entre parentesis.
      const prompt = construirPrompt(etiqueta, textoAAnalizar(texto, ctx.tipo))

      let partidos: { alimento: string; cantidad: string | null }[]
      try {
        const salida = await analizarConReintento(prompt, {
          clinicaId: ctx.tenantId,
          profesionalId: ctx.profesionalId,
          funcion: 'analisis_dietetico',
        })
        partidos = parsearAlimentos(salida)
      } catch (e) {
        // El motivo viaja en el cuerpo y el mensaje lo nombra. Antes los cuatro
        // fallos colapsaban en «no está disponible ahora mismo», y eso hacía
        // indistinguible una clave que falta —que no se arregla esperando— de
        // una saturación que sí (R46). Ver `responderFalloIa`.
        return responderFalloIa(e, request, reply, 'analisis-dietetico')
      }

      /*
       * **Aca el modelo ya termino su trabajo.** De aca en adelante no hay
       * estimacion: cada alimento se busca en `equivalencia_intercambio`, sus
       * porciones se multiplican por los valores de `grupo_intercambio` y se
       * suma. El numero sale de la base.
       */
      const grupos = await leerGrupos(ctx.tenantId)
      const resueltos: AlimentoResuelto[] = []
      for (const p of partidos) {
        resueltos.push(await resolverAlimento(ctx.tenantId, p.alimento, p.cantidad, grupos))
      }

      const encontrados = resueltos.filter((r) => r.encontrado)
      const noEncontrados = resueltos.filter((r) => !r.encontrado).map((r) => r.pedido)
      const total = sumarMacros(encontrados.map((r) => r.macros))

      /*
       * **Si no se encontro NINGUNO, no se escribe un cero.**
       *
       * Un total de cero con el texto escrito se lee como «estos alimentos no
       * aportan nada», que es falso. Los cuatro valores se quedan en null y el
       * profesional los escribe a mano.
       *
       * Lo que SI se guarda es el aviso. Antes la bandera solo viajaba en esta
       * respuesta: el profesional veia el ⚠, recargaba la consulta y el aviso
       * habia desaparecido, dejando cuatro casillas vacias sin explicacion. Se
       * persiste `ai_no_encontrado` con `ai_calculado_en` —y los macros en
       * null—, que es la combinacion que dice «esto ya se analizo y no dio
       * numeros». El boton sigue ofreciendo «Analizar IA» porque `ai_kcal`
       * sigue en null, y la cache no se envenena por lo mismo.
       */
      if (encontrados.length === 0) {
        const soloAviso = reg.filas.map((f) =>
          f.tiempo_comida === tc
            ? { ...f, ai_calculado_en: new Date().toISOString(), ai_no_encontrado: noEncontrados }
            : f,
        )
        await guardar(ctx.consultaId, ctx.tenantId, ctx.tipo, reg.observaciones, soloAviso)
        return reply.send({
          ...respuesta(await leerRegistro(ctx.consultaId, ctx.tenantId, ctx.tipo)),
          no_encontrado: true,
          alimentos_no_encontrados: noEncontrados,
          alimentos_reconocidos: [],
        })
      }

      const filas = reg.filas.map((f) =>
        f.tiempo_comida === tc
          ? {
              ...f,
              ai_kcal: total.kcal,
              ai_cho_g: total.cho_g,
              ai_prot_g: total.chon_g,
              ai_grasas_g: total.grasa_g,
              ai_calculado_en: new Date().toISOString(),
              ai_no_encontrado: noEncontrados,
            }
          : f,
      )

      await guardar(ctx.consultaId, ctx.tenantId, ctx.tipo, reg.observaciones, filas)
      const actualizado = await leerRegistro(ctx.consultaId, ctx.tenantId, ctx.tipo)

      /*
       * La bandera viaja aunque se haya podido calcular parte: «se reconocieron
       * tres de cuatro» tiene que verse. Un total que omite un alimento en
       * silencio es el defecto que esto vino a cerrar.
       */
      return reply.send({
        ...respuesta(actualizado),
        no_encontrado: noEncontrados.length > 0,
        alimentos_no_encontrados: noEncontrados,
        alimentos_reconocidos: encontrados.map((r) => ({
          alimento: r.pedido,
          cantidad: r.cantidadPedida,
          equivalencia: r.equivalencia?.alimento ?? null,
          porcion_referencia: r.equivalencia?.cantidadDescripcion ?? null,
          factor: r.factor,
          factor_supuesto: r.factorSupuesto,
          ...r.macros,
        })),
      })
    },
  )
}

/* ------------------------------------------------------------------ */
/* IA — método ADA                                                     */
/* ------------------------------------------------------------------ */

/**
 * **El prompt ya no lleva la tabla de intercambios, y el modelo ya no calcula.**
 *
 * Antes esta constante tenia los once grupos ADA escritos a mano y le pedia al
 * modelo que identificara, clasificara, multiplicara y sumara. Los valores
 * viven ahora en `grupo_intercambio` y `equivalencia_intercambio` (migracion
 * 048), y la aritmetica la hace `dietetico/intercambios.ts`.
 *
 * Al modelo le queda **una sola tarea**: leer el texto libre y partirlo en
 * alimentos con su cantidad. Ni siquiera asignar el grupo — el grupo sale de la
 * tabla al encontrar el alimento, asi que es el del documento y no la opinion
 * del modelo.
 *
 * Es la diferencia entre poder comprobar de donde salio un numero y no poder.
 */
const SISTEMA_PARTIR = `Eres un asistente de nutricion clinica. Tu unica tarea es LEER un texto libre de alimentos consumidos y partirlo en alimentos individuales con su cantidad.

NO calcules calorias ni macronutrientes. NO asignes grupos de intercambio. Solo separa y transcribe.

Reglas:
1. Un elemento por alimento mencionado. "Gallo pinto con huevo" son DOS: "gallo pinto" y "huevo".
2. Copia la cantidad tal como aparece ("1/2 taza", "2 rebanadas", "90 g"). Si el texto no dice cantidad, usa null.
3. Usa el nombre mas simple y generico del alimento, en singular y sin adornos: "arroz blanco", no "un rico arroz blanco de la abuela".
4. No agregues alimentos que el texto no menciona.
5. Responde UNICAMENTE con JSON valido, sin texto adicional, sin markdown.

Formato:
{ "alimentos": [ { "alimento": "arroz blanco", "cantidad": "1/2 taza" } ] }`

export function construirPrompt(etiqueta: string, texto: string): string {
  return `${SISTEMA_PARTIR}\n\nTiempo de comida: ${etiqueta}\nTexto a partir: ${texto}\n\nDevuelve el JSON con los alimentos y sus cantidades.`
}

/**
 * Extrae el JSON de la respuesta (tolera cercas de markdown) y valida.
 *
 * **Lo que se descarta se descarta, no se convierte en cero.** La version
 * anterior devolvia cuatro numeros y mapeaba cualquier valor no numerico a `0`;
 * un alimento que el modelo no supo leer aparecia como un alimento sin
 * calorias. Ahora lo que no se entiende no entra en la lista, y lo que entra
 * pero no esta en el documento sale marcado como no encontrado.
 */
export function parsearAlimentos(texto: string): { alimento: string; cantidad: string | null }[] {
  let limpio = texto.trim()
  const cerca = limpio.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (cerca?.[1]) limpio = cerca[1].trim()
  else {
    const inicio = limpio.indexOf('{')
    const fin = limpio.lastIndexOf('}')
    if (inicio !== -1 && fin !== -1) limpio = limpio.slice(inicio, fin + 1)
  }

  const obj = JSON.parse(limpio) as Record<string, unknown>
  const crudos = Array.isArray(obj['alimentos']) ? (obj['alimentos'] as unknown[]) : []

  const salida: { alimento: string; cantidad: string | null }[] = []
  for (const cruda of crudos) {
    const o = (cruda ?? {}) as Record<string, unknown>
    const nombre = typeof o['alimento'] === 'string' ? o['alimento'].trim() : ''
    if (nombre === '') continue
    const cantidad =
      typeof o['cantidad'] === 'string' && o['cantidad'].trim() !== ''
        ? o['cantidad'].trim()
        : null
    salida.push({ alimento: nombre, cantidad })
  }
  return salida
}

/** Un reintento tras 2 s si el modelo devuelve límite de uso (429). */
async function analizarConReintento(
  prompt: string,
  ctx: {
    clinicaId: string
    profesionalId: string | null
    funcion: 'analisis_dietetico' | 'identificacion_dietetica'
  },
): Promise<string> {
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
