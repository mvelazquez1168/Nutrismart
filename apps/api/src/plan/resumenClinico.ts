/**
 * El resumen clinico del plan alimentario — R49.
 *
 * Cuando el profesional guarda el plan de una consulta, aqui se reune lo
 * que la consulta dejo en la base, se calcula la distribucion de macros,
 * se le pide al modelo que redacte los otros seis bloques y el resultado
 * se guarda en `resumen_clinico_plan` (migracion 049). Al visualizarlo
 * despues se lee esa fila: no se vuelve a generar.
 *
 * ## Dos reglas que gobiernan este archivo
 *
 * **1. Guardar el plan nunca falla por la IA.** Es la regla de oro del
 * proyecto — nunca bloquear el acceso clinico — aplicada a este caso: si
 * el modelo no esta configurado, se cae o tarda, el plan ya quedo
 * guardado y el profesional recibe un 200. Lo que cambia es la bandera
 * del resumen, no el resultado del guardado. Por eso `generarResumen`
 * devuelve un estado en vez de lanzar.
 *
 * **2. Los numeros no los escribe el modelo.** El bloque de distribucion
 * de macros lo arma `textoDistribucion` con los gramos y las kilocalorias
 * de `conclusion_valoracion`, y los porcentajes se RECALCULAN desde los
 * gramos. Un porcentaje del VCT que sale de un modelo de lenguaje no se
 * puede comprobar contra nada; uno que sale de 4/4/9 kcal por gramo, si.
 */
import { pool } from '../db.js'
import { llamarClaude } from '../ia/cliente.js'
import { promptResumenClinico, partirResumen, type DatosResumenPlan } from '../ia/prompts.js'

/* ------------------------------------------------------------------ */
/* La distribucion de macros: aritmetica, no redaccion                 */
/* ------------------------------------------------------------------ */

export interface MacrosPlan {
  kcal: number | null
  choG: number | null
  protG: number | null
  grasaG: number | null
  choPct: number | null
  protPct: number | null
  grasaPct: number | null
  /**
   * De donde salieron las cifras: la prescripcion de la consulta
   * (`conclusion`), la calculadora (`calculadora`), o ningun lado
   * (`ausente`).
   */
  fuente: 'conclusion' | 'calculadora' | 'ausente'
}

const KCAL_POR_GRAMO = { cho: 4, prot: 4, grasa: 9 } as const

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function redondear(n: number, decimales = 1): number {
  const f = 10 ** decimales
  return Math.round(n * f) / f
}

/**
 * Arma los macros del plan diario desde lo que haya en la consulta.
 *
 * Las kilocalorias, si no estan registradas, se derivan de los gramos
 * (4/4/9). Los porcentajes se derivan SIEMPRE de los gramos y del total
 * calorico, incluso cuando la fila ya trae un `pct_*`: asi el porcentaje
 * y los gramos que muestra el resumen no pueden contradecirse.
 *
 * Sin gramos ni kilocalorias devuelve `fuente: 'ausente'`, con todo en
 * null. **Cero no es un valor valido aqui**: un plan de 0 kcal se leeria
 * como una prescripcion de ayuno. La ausencia se dice, no se rellena.
 */
export function calcularMacros(
  conclusion: Record<string, unknown> | undefined,
  datosCalculadora: Record<string, unknown> | null,
): MacrosPlan {
  const vacio: MacrosPlan = {
    kcal: null,
    choG: null,
    protG: null,
    grasaG: null,
    choPct: null,
    protPct: null,
    grasaPct: null,
    fuente: 'ausente',
  }

  let choG = num(conclusion?.['cho_g'])
  let protG = num(conclusion?.['proteina_g'])
  let grasaG = num(conclusion?.['grasa_g'])
  let kcal = num(conclusion?.['kcal_prescritas'])
  let fuente: MacrosPlan['fuente'] = 'conclusion'

  // Respaldo: el documento cerrado de la calculadora (R39). Se usa solo
  // si la conclusion no trajo nada, no para rellenar huecos sueltos:
  // mezclar los gramos de una fuente con las kcal de otra produciria una
  // distribucion que no suma.
  if (choG === null && protG === null && grasaG === null && kcal === null && datosCalculadora) {
    const d = datosCalculadora as {
      metaCalorica?: unknown
      distribucionMacros?: { choG?: unknown; protG?: unknown; grasaG?: unknown }
    }
    const m = d.distribucionMacros ?? {}
    choG = num(m.choG)
    protG = num(m.protG)
    grasaG = num(m.grasaG)
    kcal = num(d.metaCalorica)
    fuente = 'calculadora'
  }

  if (choG === null && protG === null && grasaG === null && kcal === null) return vacio

  const kcalDeGramos =
    (choG ?? 0) * KCAL_POR_GRAMO.cho +
    (protG ?? 0) * KCAL_POR_GRAMO.prot +
    (grasaG ?? 0) * KCAL_POR_GRAMO.grasa

  const total = kcal !== null && kcal > 0 ? kcal : kcalDeGramos > 0 ? redondear(kcalDeGramos, 0) : null

  const pct = (gramos: number | null, porGramo: number): number | null =>
    gramos === null || total === null || total <= 0
      ? null
      : redondear((gramos * porGramo * 100) / total, 0)

  return {
    kcal: total,
    choG: choG === null ? null : redondear(choG),
    protG: protG === null ? null : redondear(protG),
    grasaG: grasaG === null ? null : redondear(grasaG),
    choPct: pct(choG, KCAL_POR_GRAMO.cho),
    protPct: pct(protG, KCAL_POR_GRAMO.prot),
    grasaPct: pct(grasaG, KCAL_POR_GRAMO.grasa),
    fuente,
  }
}

/** El bloque 5, en texto. Es lo que se guarda y lo que se muestra. */
export function textoDistribucion(m: MacrosPlan): string {
  if (m.fuente === 'ausente') {
    return 'No se registro la prescripcion de macronutrientes de este plan. Define la meta calorica y la distribucion en las conclusiones de la consulta para que el resumen pueda incluirla.'
  }

  const linea = (nombre: string, g: number | null, p: number | null): string => {
    if (g === null && p === null) return `${nombre}: no registrado`
    const gramos = g === null ? 'gramos no registrados' : `${g} g`
    const porc = p === null ? '' : ` (${p} % del VCT)`
    return `${nombre}: ${gramos}${porc}`
  }

  const partes = [
    m.kcal === null ? 'Valor calorico total: no registrado' : `Valor calorico total: ${m.kcal} kcal/dia`,
    linea('Carbohidratos', m.choG, m.choPct),
    linea('Proteinas', m.protG, m.protPct),
    linea('Grasas', m.grasaG, m.grasaPct),
  ]

  if (m.fuente === 'calculadora') {
    partes.push('Cifras tomadas de la calculadora nutricional de la consulta.')
  }
  return partes.join('\n')
}

/* ------------------------------------------------------------------ */
/* Reunir el contexto de la consulta                                   */
/* ------------------------------------------------------------------ */

const TIEMPOS: Record<string, string> = {
  desayuno: 'Desayuno',
  merienda_am: 'Merienda de la manana',
  almuerzo: 'Almuerzo',
  merienda_pm: 'Merienda de la tarde',
  cena: 'Cena',
  colacion_nocturna: 'Colacion nocturna',
}

export interface ContextoResumen {
  datos: DatosResumenPlan
  macros: MacrosPlan
  consultaId: string | null
}

/**
 * Reune lo que hay. Cada bloque es opcional.
 *
 * ## La consulta se resuelve, no se recibe
 *
 * `plan_alimentario` no tiene `consulta_id`: un plan se puede crear desde
 * la ficha del paciente sin consulta de por medio. Asi que la consulta de
 * la que salen los datos clinicos es **la ultima conclusion de valoracion
 * del paciente**, y su id queda escrito en el resumen.
 *
 * Es una lectura, y la dejo anotada: si el profesional guarda hoy un plan
 * viejo, el resumen se redacta con la consulta mas reciente, no con la
 * que originalmente dio lugar al plan. Es lo correcto en el caso que
 * importa —guardar el plan de la consulta en curso, que es cuando esto se
 * dispara— y la alternativa seria atar el plan a una consulta, que es un
 * cambio de modelo mas grande de lo que este trabajo supone.
 */
export async function reunirContexto(
  planId: string,
  clinicaId: string,
): Promise<ContextoResumen | null> {
  const plan = await pool.query(
    `select pa.id, pa.nombre, pa.objetivo, pa.notas, pa.paciente_id,
            p.nombre as paciente_nombre,
            case when p.fecha_nacimiento is null then null
                 else extract(year from age(p.fecha_nacimiento))::int end as edad,
            p.sexo_biologico::text as sexo
       from plan_alimentario pa
       join paciente p on p.id = pa.paciente_id and p.clinica_id = pa.clinica_id
      where pa.id = $1 and pa.clinica_id = $2`,
    [planId, clinicaId],
  )
  const pl = plan.rows[0]
  if (!pl) return null

  const pacienteId = pl['paciente_id'] as string

  const [comidas, concl, antrop, labs, hist, tareas] = await Promise.all([
    pool.query(
      `select tipo_comida, patron, ejemplo_menu from plan_comida
        where plan_id = $1 and clinica_id = $2`,
      [planId, clinicaId],
    ),
    pool.query(
      `select consulta_id, diagnostico_principal, diagnostico_secundario,
              observaciones_clinicas, objetivos, justificacion, recomendaciones,
              kcal_prescritas, pct_proteina, pct_cho, pct_grasa,
              proteina_g, cho_g, grasa_g, restricciones, suplementos,
              acuerdos, datos_calculadora
         from conclusion_valoracion
        where paciente_id = $1 and clinica_id = $2
        order by updated_at desc limit 1`,
      [pacienteId, clinicaId],
    ),
    pool.query(
      `select peso_kg, talla_cm, imc, pct_grasa, masa_libre_grasa_kg, fecha_medicion
         from medicion_antropometrica
        where paciente_id = $1 and clinica_id = $2
        order by fecha_medicion desc, created_at desc limit 1`,
      [pacienteId, clinicaId],
    ),
    pool.query(
      `select b.nombre, r.valor, b.unidad
         from lab_resultado r
         join lab_estudio e on e.id = r.estudio_id
         join biomarcador b on b.codigo = r.biomarcador_codigo
        where e.paciente_id = $1 and e.clinica_id = $2 and e.estado = 'vigente'
          and e.fecha >= current_date - interval '180 days'
        order by e.fecha desc limit 20`,
      [pacienteId, clinicaId],
    ),
    pool.query(
      `select tipo_actividad, sesiones_semana, fuma, alcohol, app
         from historial_clinico where paciente_id = $1 and clinica_id = $2`,
      [pacienteId, clinicaId],
    ),
    pool.query(
      `select titulo from tarea_paciente
        where paciente_id = $1 and clinica_id = $2 and estado = 'pendiente'
        order by created_at desc limit 10`,
      [pacienteId, clinicaId],
    ),
  ])

  const c = concl.rows[0]
  const a = antrop.rows[0]
  const h = hist.rows[0]

  const macros = calcularMacros(
    c,
    (c?.['datos_calculadora'] ?? null) as Record<string, unknown> | null,
  )

  const antropometria = a
    ? [
        num(a['peso_kg']) !== null ? `peso ${num(a['peso_kg'])} kg` : null,
        num(a['talla_cm']) !== null ? `talla ${num(a['talla_cm'])} cm` : null,
        num(a['imc']) !== null ? `IMC ${num(a['imc'])}` : null,
        num(a['pct_grasa']) !== null ? `grasa corporal ${num(a['pct_grasa'])} %` : null,
        num(a['masa_libre_grasa_kg']) !== null
          ? `masa libre de grasa ${num(a['masa_libre_grasa_kg'])} kg`
          : null,
      ]
        .filter(Boolean)
        .join(', ') || null
    : null

  const datos: DatosResumenPlan = {
    pacienteNombre: ((pl['paciente_nombre'] as string | null) ?? '').trim(),
    pacienteEdad: num(pl['edad']),
    pacienteSexo: (pl['sexo'] as string | null) ?? null,

    planNombre: pl['nombre'] as string,
    planObjetivo: (pl['objetivo'] as string | null) ?? null,
    planNotas: (pl['notas'] as string | null) ?? null,
    comidas: comidas.rows.map((r) => ({
      tiempo: TIEMPOS[r['tipo_comida'] as string] ?? (r['tipo_comida'] as string),
      patron: (r['patron'] as string | null) ?? null,
      ejemploMenu: (r['ejemplo_menu'] as string | null) ?? null,
    })),

    diagnostico:
      [c?.['diagnostico_principal'], c?.['diagnostico_secundario']]
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .join('; ') || null,
    objetivosConclusion: (c?.['objetivos'] as string | null) ?? null,
    observacionesConclusion: (c?.['observaciones_clinicas'] as string | null) ?? null,
    justificacionConclusion: (c?.['justificacion'] as string | null) ?? null,
    antropometria,
    laboratorios:
      labs.rows.length > 0
        ? labs.rows.map((r) => `${r['nombre']} ${r['valor']} ${r['unidad'] ?? ''}`.trim()).join('; ')
        : null,
    antecedentes: h
      ? [
          h['tipo_actividad'] ? `actividad ${h['tipo_actividad']}` : null,
          num(h['sesiones_semana']) !== null ? `${num(h['sesiones_semana'])} sesiones por semana` : null,
          h['fuma'] === true ? 'fuma' : null,
          h['alcohol'] === true ? 'consume alcohol' : null,
          Array.isArray(h['app']) && h['app'].length > 0
            ? `antecedentes personales: ${(h['app'] as { condicion?: string }[])
                .map((x) => x.condicion)
                .filter(Boolean)
                .join(', ')}`
            : null,
        ]
          .filter(Boolean)
          .join('; ') || null
      : null,
    recomendaciones: Array.isArray(c?.['recomendaciones']) ? (c['recomendaciones'] as string[]) : [],
    restricciones: Array.isArray(c?.['restricciones']) ? (c['restricciones'] as string[]) : [],
    suplementos: (c?.['suplementos'] as string | null) ?? null,
    acuerdos: Array.isArray(c?.['acuerdos'])
      ? (c['acuerdos'] as { texto?: string }[]).map((x) => x.texto ?? '').filter((x) => x !== '')
      : [],
    tareas: tareas.rows.map((r) => r['titulo'] as string),

    distribucionMacros: textoDistribucion(macros),
  }

  return { datos, macros, consultaId: (c?.['consulta_id'] as string | null) ?? null }
}

/* ------------------------------------------------------------------ */
/* Generar y guardar                                                   */
/* ------------------------------------------------------------------ */

export type EstadoResumen = 'generado' | 'sin_plan' | 'sin_ia' | 'fallo'

export interface ResultadoGeneracion {
  estado: EstadoResumen
  resumenId: string | null
  /** Por que no se genero, cuando no se genero. Para el log, no para la UI. */
  motivo?: string
}

/**
 * Genera el resumen y lo guarda. **No lanza.**
 *
 * Quien la llama acaba de guardar un plan y ese guardado ya es un hecho.
 * Un error aqui se convierte en un estado, nunca en una excepcion que
 * tumbe la respuesta: perder el resumen es molesto, perder la
 * prescripcion que el profesional acaba de escribir es inaceptable.
 */
export async function generarResumen(
  planId: string,
  clinicaId: string,
  profesionalId: string | null,
): Promise<ResultadoGeneracion> {
  let ctx: ContextoResumen | null
  try {
    ctx = await reunirContexto(planId, clinicaId)
  } catch (e) {
    console.error('[resumen-plan] no se pudo reunir el contexto de %s:', planId, e)
    return { estado: 'fallo', resumenId: null, motivo: 'contexto' }
  }
  if (!ctx) return { estado: 'sin_plan', resumenId: null }

  let bloques = {
    objetivos: null as string | null,
    observacionesClinicas: null as string | null,
    justificacion: null as string | null,
    planAlimentario: null as string | null,
    recomendaciones: null as string | null,
    tareas: null as string | null,
  }
  let origen: 'ia' | 'datos' = 'ia'
  let modelo: string | null = null
  let tokensSalida: number | null = null

  try {
    const salida = await llamarClaude(promptResumenClinico(ctx.datos), {
      clinicaId,
      profesionalId,
      funcion: 'resumen_clinico_plan',
    })
    bloques = partirResumen(salida.texto)
    modelo = salida.modelo
    tokensSalida = salida.tokensSalida
  } catch (e) {
    /*
     * La IA no estaba. Se guarda igual un resumen de origen 'datos': los
     * bloques que son transcripcion directa de la consulta se llenan con
     * lo que el profesional ya escribio, y los que requieren redaccion
     * quedan vacios.
     *
     * Es mejor que no guardar nada. El profesional abre el modal y ve su
     * prescripcion y sus macros, con el aviso de que la redaccion no se
     * pudo generar — en vez de un modal vacio que no explica por que.
     */
    console.error('[resumen-plan] la IA no pudo redactar el resumen de %s:', planId, e)
    origen = 'datos'
    bloques = {
      objetivos: ctx.datos.objetivosConclusion ?? ctx.datos.planObjetivo,
      observacionesClinicas: [ctx.datos.antropometria, ctx.datos.laboratorios, ctx.datos.observacionesConclusion]
        .filter(Boolean)
        .join('\n') || null,
      justificacion: ctx.datos.justificacionConclusion,
      planAlimentario:
        ctx.datos.comidas
          .filter((x) => (x.patron ?? '').trim() !== '' || (x.ejemploMenu ?? '').trim() !== '')
          .map((x) => `${x.tiempo}: ${[x.patron, x.ejemploMenu].filter(Boolean).join(' — ')}`)
          .join('\n') || null,
      recomendaciones:
        [...ctx.datos.recomendaciones, ctx.datos.suplementos ? `Suplementos: ${ctx.datos.suplementos}` : null]
          .filter(Boolean)
          .join('\n') || null,
      tareas: [...ctx.datos.tareas, ...ctx.datos.acuerdos].join('\n') || null,
    }
  }

  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into resumen_clinico_plan
         (clinica_id, plan_id, consulta_id, profesional_id,
          objetivos, observaciones_clinicas, justificacion, plan_alimentario,
          distribucion_macros, recomendaciones, tareas,
          macros_json, origen, modelo, tokens_salida)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       returning id`,
      [
        clinicaId,
        planId,
        ctx.consultaId,
        profesionalId,
        bloques.objetivos,
        bloques.observacionesClinicas,
        bloques.justificacion,
        bloques.planAlimentario,
        ctx.datos.distribucionMacros,
        bloques.recomendaciones,
        bloques.tareas,
        JSON.stringify(ctx.macros),
        origen,
        modelo,
        tokensSalida,
      ],
    )
    return {
      estado: origen === 'ia' ? 'generado' : 'sin_ia',
      resumenId: rows[0]?.id ?? null,
    }
  } catch (e) {
    console.error('[resumen-plan] no se pudo guardar el resumen de %s:', planId, e)
    return { estado: 'fallo', resumenId: null, motivo: 'persistencia' }
  }
}

/* ------------------------------------------------------------------ */
/* Leer                                                                */
/* ------------------------------------------------------------------ */

export interface ResumenPlan {
  id: string
  planId: string
  generadoEn: string
  origen: 'ia' | 'datos'
  modelo: string | null
  bloques: {
    objetivos: string | null
    observacionesClinicas: string | null
    justificacion: string | null
    planAlimentario: string | null
    distribucionMacros: string | null
    recomendaciones: string | null
    tareas: string | null
  }
  macros: MacrosPlan | null
}

/**
 * El ultimo resumen de un plan, o null si no tiene ninguno.
 *
 * Null es un estado legitimo y frecuente: todos los planes que existian
 * antes de la R49 no tienen resumen, y el plan que se guardo cuando la IA
 * estaba caida tampoco. Por eso quien expone esto devuelve 200 con
 * `existe: false` y no un 404 — un 404 aqui significaria «este plan no
 * existe», que es otra cosa.
 */
export async function leerUltimoResumen(
  planId: string,
  clinicaId: string,
): Promise<ResumenPlan | null> {
  const { rows } = await pool.query(
    `select id, plan_id, origen, modelo, macros_json,
            objetivos, observaciones_clinicas, justificacion, plan_alimentario,
            distribucion_macros, recomendaciones, tareas,
            to_char(generado_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as generado_en
       from resumen_clinico_plan
      where plan_id = $1 and clinica_id = $2
      order by generado_en desc limit 1`,
    [planId, clinicaId],
  )
  const r = rows[0]
  if (!r) return null

  return {
    id: r['id'] as string,
    planId: r['plan_id'] as string,
    generadoEn: r['generado_en'] as string,
    origen: r['origen'] as 'ia' | 'datos',
    modelo: (r['modelo'] as string | null) ?? null,
    bloques: {
      objetivos: (r['objetivos'] as string | null) ?? null,
      observacionesClinicas: (r['observaciones_clinicas'] as string | null) ?? null,
      justificacion: (r['justificacion'] as string | null) ?? null,
      planAlimentario: (r['plan_alimentario'] as string | null) ?? null,
      distribucionMacros: (r['distribucion_macros'] as string | null) ?? null,
      recomendaciones: (r['recomendaciones'] as string | null) ?? null,
      tareas: (r['tareas'] as string | null) ?? null,
    },
    macros: (r['macros_json'] as MacrosPlan | null) ?? null,
  }
}

/** Los ids de los planes de una lista que YA tienen resumen. */
export async function planesConResumen(
  planIds: string[],
  clinicaId: string,
): Promise<Set<string>> {
  if (planIds.length === 0) return new Set()
  const { rows } = await pool.query<{ plan_id: string }>(
    `select distinct plan_id from resumen_clinico_plan
      where clinica_id = $1 and plan_id = any($2::uuid[])`,
    [clinicaId, planIds],
  )
  return new Set(rows.map((r) => r.plan_id))
}
