/**
 * Motor de alertas — RPM-03.
 *
 * Cada pasada hace dos cosas, en este orden:
 *
 *   1. **Cierra** las alertas abiertas cuya condición ya no se cumple.
 *   2. **Abre** una alerta por cada regla cuya condición se cumple y no
 *      tenía ya una abierta.
 *
 * Lo primero es lo que hace la pantalla utilizable. Sin resolución
 * automática, una glucosa que subió un martes y bajó el miércoles deja
 * una alerta viva para siempre; a las tres semanas el panel es una lista
 * de cosas ya resueltas y el profesional deja de mirarlo. Una alerta que
 * no se cierra sola es peor que no tener alertas.
 *
 * Y todo en dos consultas de conjunto, no una por regla. El encargo
 * recorría las configuraciones en un bucle con una consulta dentro: con
 * quinientos pacientes y tres reglas cada uno son mil quinientas idas y
 * vueltas a la base cada mañana.
 */
import { pool } from '../db.js'

/**
 * Valor actual de cada regla activa.
 *
 * Un `LEFT JOIN LATERAL` por origen y un `CASE` que elige el que toca.
 * Los tres orígenes se resuelven una vez por regla, no una por regla y
 * por tipo.
 *
 * Dos cosas que el encargo tenía mal y aquí no:
 *
 * `registro_metrica` **no tiene columna `fecha`** — es `medido_en`, un
 * `timestamptz`. Es el mismo fallo que la Rebanada 26.
 *
 * Los días de silencio se cuentan restando fechas (`date - date` da un
 * entero de días). El encargo usaba `extract(day from interval)`, que
 * devuelve solo el componente «días» del intervalo: para un mes y tres
 * días da 3, no 33. Justo en la métrica que existe para detectar
 * abandonos largos.
 */
const SQL_VALORES = `
with hoy as (select (now() at time zone 'America/Costa_Rica')::date as d)
select c.id            as config_id,
       c.clinica_id, c.paciente_id, c.profesional_id,
       c.metrica::text as metrica,
       c.operador::text as operador,
       c.umbral::float8 as umbral,
       c.ventana_dias,
       c.mensaje,

       case c.metrica
         when 'peso'               then m.valor::float8
         when 'glucosa'            then m.valor::float8
         when 'presion_sistolica'  then m.sistolica::float8
         when 'presion_diastolica' then m.diastolica::float8
         when 'bienestar'          then b.estado::float8
         when 'dias_sin_diario'    then (select d from hoy) - coalesce(com.fecha, alta.desde)
         when 'dias_sin_registro'  then (select d from hoy) - coalesce(act.fecha, alta.desde)
       end as valor,

       case c.metrica
         when 'bienestar' then b.medido_en
         when 'dias_sin_diario'   then null
         when 'dias_sin_registro' then null
         else m.medido_en
       end as observado_en,

       -- Antigüedad del dato, en días. Solo se usa en las métricas de
       -- valor: en las de silencio la falta de datos ES la medida.
       case c.metrica
         when 'bienestar' then (select d from hoy) - b.fecha
         when 'dias_sin_diario'   then 0
         when 'dias_sin_registro' then 0
         else (select d from hoy) - (m.medido_en at time zone 'America/Costa_Rica')::date
       end as antiguedad_dias

  from alerta_config c
  join paciente p on p.id = c.paciente_id and p.estado = 'activo'

  left join lateral (
    select valor, sistolica, diastolica, medido_en
      from registro_metrica r
     where r.paciente_id = c.paciente_id
       and r.activo
       and r.tipo = (case c.metrica
                       when 'presion_sistolica'  then 'presion_arterial'
                       when 'presion_diastolica' then 'presion_arterial'
                       when 'peso'               then 'peso'
                       when 'glucosa'            then 'glucosa'
                       else null
                     end)::tipo_metrica
     order by r.medido_en desc, r.id desc
     limit 1
  ) m on true

  left join lateral (
    select estado, fecha, fecha::timestamptz as medido_en
      from registro_bienestar rb
     where rb.paciente_id = c.paciente_id and rb.activo
     order by rb.fecha desc, rb.id desc
     limit 1
  ) b on true

  -- Desde cuándo el paciente PUEDE apuntar cosas: el día que activó su
  -- cuenta. Sin esto, quien nunca apuntó nada quedaba fuera de las
  -- métricas de silencio —un max() de nada es null y la regla se saltaba—
  -- y es justamente a quien más interesa detectar: el que recibió la
  -- invitación, entró una vez y no volvió.
  left join lateral (
    select min(usado_en)::date as desde
      from invitacion_paciente i
     where i.paciente_id = c.paciente_id and i.usado_en is not null
  ) alta on true

  left join lateral (
    select max(fecha) as fecha from registro_comida rc
     where rc.paciente_id = c.paciente_id and rc.activo
  ) com on true

  -- «Sin ningún registro»: la más reciente de las tres cosas que el
  -- paciente puede apuntar.
  left join lateral (
    select max(f) as fecha from (
      select max(fecha) as f from registro_comida x
        where x.paciente_id = c.paciente_id and x.activo
      union all
      select max((medido_en at time zone 'America/Costa_Rica')::date) from registro_metrica x
        where x.paciente_id = c.paciente_id and x.activo
      union all
      select max(fecha) from registro_bienestar x
        where x.paciente_id = c.paciente_id and x.activo
    ) t
  ) act on true

 where c.activo = true
`

interface Fila {
  config_id: string
  clinica_id: string
  paciente_id: string
  profesional_id: string
  metrica: string
  operador: string
  umbral: number
  ventana_dias: number
  mensaje: string | null
  valor: number | null
  observado_en: Date | null
  antiguedad_dias: number | null
}

function cumple(valor: number, operador: string, umbral: number): boolean {
  switch (operador) {
    case 'mayor_que':
      return valor > umbral
    case 'menor_que':
      return valor < umbral
    case 'mayor_igual_que':
      return valor >= umbral
    case 'menor_igual_que':
      return valor <= umbral
    default:
      return false
  }
}

const ETIQUETA: Record<string, string> = {
  peso: 'El peso',
  glucosa: 'La glucosa',
  presion_sistolica: 'La presión sistólica',
  presion_diastolica: 'La presión diastólica',
  bienestar: 'El bienestar reportado',
  dias_sin_diario: 'El diario de comidas',
  dias_sin_registro: 'Los registros',
}

const UNIDAD: Record<string, string> = {
  peso: ' kg',
  glucosa: ' mg/dL',
  presion_sistolica: ' mmHg',
  presion_diastolica: ' mmHg',
  bienestar: ' de 5',
  dias_sin_diario: '',
  dias_sin_registro: '',
}

/** Redondeo a un decimal para el texto. */
const r1 = (n: number) => Math.round(n * 10) / 10

function mensajeDe(f: Fila, valor: number): string {
  if (f.metrica === 'dias_sin_diario') {
    return `Lleva ${Math.round(valor)} días sin apuntar ninguna comida.`
  }
  if (f.metrica === 'dias_sin_registro') {
    return `Lleva ${Math.round(valor)} días sin apuntar nada en la aplicación.`
  }
  const comp =
    f.operador === 'mayor_que' || f.operador === 'mayor_igual_que'
      ? 'por encima del umbral de'
      : 'por debajo del umbral de'
  return `${ETIQUETA[f.metrica] ?? f.metrica} está en ${r1(valor)}${UNIDAD[f.metrica] ?? ''}, ${comp} ${r1(f.umbral)}${UNIDAD[f.metrica] ?? ''}.`
}

export interface ResultadoEvaluacion {
  abiertas: number
  resueltas: number
  evaluadas: number
  omitidasPorAntiguedad: number
}

/**
 * Evalúa las reglas. Si se pasa `pacienteId`, solo las de ese paciente
 * —es lo que se usa al crear o editar una regla, para que el profesional
 * vea el resultado sin esperar al ciclo de mañana—.
 */
export async function evaluarAlertas(pacienteId?: string): Promise<ResultadoEvaluacion> {
  const { rows } = await pool.query<Fila>(
    pacienteId ? `${SQL_VALORES} and c.paciente_id = $1` : SQL_VALORES,
    pacienteId ? [pacienteId] : [],
  )

  const seCumple = new Set<string>()
  const aAbrir: Fila[] = []
  let omitidas = 0

  for (const f of rows) {
    const valor = f.valor === null ? null : Number(f.valor)
    if (valor === null || !Number.isFinite(valor)) continue

    // Un dato viejo no dispara nada. Ver la nota de la migración 031:
    // sin esto, quien dejó de pesarse hace seis meses con 91 kg genera
    // una alerta nueva cada día para siempre.
    const esDeSilencio = f.metrica === 'dias_sin_diario' || f.metrica === 'dias_sin_registro'
    if (!esDeSilencio && (f.antiguedad_dias ?? 0) > f.ventana_dias) {
      omitidas++
      continue
    }

    if (!cumple(valor, f.operador, f.umbral)) continue
    seCumple.add(f.config_id)
    aAbrir.push({ ...f, valor })
  }

  // ── 1. Cerrar lo que ya no se cumple ──────────────────────────────
  //
  // Se hace ANTES de abrir, y con la lista completa de reglas que sí se
  // cumplen: una regla que dejó de cumplirse porque el dato caducó
  // también se cierra, y es correcto — el problema ya no se observa.
  const idsVivos = [...seCumple]
  const { rowCount: resueltas } = await pool.query(
    `update alerta_rpm
        set estado = 'resuelta', resuelta_en = now(), resuelta_auto = true, updated_at = now()
      where estado <> 'resuelta'
        and ($1::uuid is null or paciente_id = $1)
        and not (config_id = any($2::uuid[]))`,
    [pacienteId ?? null, idsVivos],
  )

  // ── 2. Abrir lo que se cumple y no tenía alerta viva ──────────────
  //
  // El índice único parcial sobre `config_id where estado <> 'resuelta'`
  // hace el trabajo: si ya hay una abierta, este INSERT no hace nada. No
  // hay que consultar antes ni hay carrera posible con otra instancia.
  let abiertas = 0
  for (const f of aAbrir) {
    const { rowCount } = await pool.query(
      `insert into alerta_rpm
         (clinica_id, paciente_id, profesional_id, config_id, metrica,
          valor_observado, umbral, observado_en, mensaje, fecha_deteccion)
       values ($1,$2,$3,$4,$5::alerta_metrica,$6,$7,$8,$9,
               (now() at time zone 'America/Costa_Rica')::date)
       on conflict do nothing`,
      [
        f.clinica_id,
        f.paciente_id,
        f.profesional_id,
        f.config_id,
        f.metrica,
        f.valor,
        f.umbral,
        f.observado_en,
        f.mensaje ?? mensajeDe(f, f.valor as number),
      ],
    )
    if (rowCount && rowCount > 0) abiertas++
  }

  return {
    abiertas,
    resueltas: resueltas ?? 0,
    evaluadas: rows.length,
    omitidasPorAntiguedad: omitidas,
  }
}
