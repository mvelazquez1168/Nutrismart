/**
 * Recopilación de los datos del expediente para exportarlo — CLI-05.
 *
 * Todo se acota por clínica, sin excepción, aunque el paciente ya venga
 * validado por la ruta: una consulta sin tenant es una fuga esperando a
 * que alguien la reutilice en otro sitio.
 *
 * Las secciones que el profesional no pidió NO se consultan. No es solo
 * ahorro: si la sociodemografía no va en el documento, tampoco tiene
 * por qué salir de la base.
 */
import { pool } from '../db.js'
import { almacen } from '../almacen/index.js'
import { listarEstudios, type Estudio } from '../laboratorios/repositorio.js'

export const SECCIONES_VALIDAS = ['perfil', 'plan', 'laboratorios', 'sociodemografico'] as const
export type Seccion = (typeof SECCIONES_VALIDAS)[number]

export interface DatosPDF {
  clinica: {
    nombre: string
    /** data: URI, o null. Nunca una URL: ver `logoIncrustado`. */
    logo: string | null
    colorPrimario: string
  }
  paciente: {
    nombre: string
    fechaNacimiento: string | null
    edad: number | null
    documento: string | null
    correo: string | null
    telefono: string | null
    numeroExpediente: string | null
    alergias: string[]
    diagnosticos: string[]
  }
  profesional: { nombre: string; colegiatura: string | null }
  plan: PlanDatos | null
  laboratorios: Estudio[]
  sociodemografico: SocioDatos | null
  notasProfesional: string
  generadoEn: string
}

export interface PlanDatos {
  nombre: string
  objetivo: string | null
  fechaInicio: string | null
  fechaFin: string | null
  dias: Record<string, { tipoComida: string; descripcion: string; caloriasKcal: number | null }[]>
}

export interface SocioDatos {
  nivelActividad: string | null
  horasSueno: number | null
  tabaco: boolean | null
  alcohol: string | null
  ocupacion: string | null
  escolaridad: string | null
  personasEnHogar: number | null
  tipoHogar: string | null
}

const ETIQUETA_DOCUMENTO: Record<string, string> = {
  cedula: 'Cédula',
  dimex: 'DIMEX',
  pasaporte: 'Pasaporte',
  nite: 'NITE',
}

/**
 * El logo viaja INCRUSTADO como data: URI, no como URL.
 *
 * Chromium renderiza el HTML con `setContent`, fuera de cualquier
 * origen: una ruta como `/api/brand/logo` no resuelve contra nada, y
 * aunque resolviera, la petición saldría sin la cabecera Authorization.
 * El resultado sería un hueco silencioso justo en la cabecera del
 * documento, que es donde más se nota.
 */
async function logoIncrustado(ruta: string | null, mime: string | null): Promise<string | null> {
  if (!ruta || !mime) return null
  try {
    const bytes = await almacen.leer(ruta)
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    // Un logo que no está no puede tumbar la exportación de un
    // expediente clínico. El documento sale sin él.
    return null
  }
}

/** Edad cumplida a partir de una fecha 'AAAA-MM-DD'. */
function edadDe(fechaNacimiento: string | null): number | null {
  if (!fechaNacimiento) return null
  const [a, m, d] = fechaNacimiento.split('-').map(Number)
  if (!a || !m || !d) return null

  const hoy = new Date()
  let edad = hoy.getUTCFullYear() - a
  const mesActual = hoy.getUTCMonth() + 1
  if (mesActual < m || (mesActual === m && hoy.getUTCDate() < d)) edad--
  return edad >= 0 && edad < 130 ? edad : null
}

export async function recopilarDatos(opciones: {
  tenantId: string
  restringirA: string | null
  pacienteId: string
  profesionalId: string
  secciones: Seccion[]
  notasProfesional: string
}): Promise<DatosPDF | null> {
  const { tenantId, restringirA, pacienteId, profesionalId, secciones, notasProfesional } = opciones

  /* ---- Clínica y marca ---- */
  const { rows: cli } = await pool.query<{
    nombre_comercial: string
    logo_ruta: string | null
    logo_mime: string | null
    color_primario: string | null
  }>(
    `select c.nombre_comercial, b.logo_ruta, b.logo_mime, b.color_primario
       from clinica c
       left join brand_config b on b.clinica_id = c.id
      where c.id = $1`,
    [tenantId],
  )
  const clinicaFila = cli[0]
  if (!clinicaFila) return null

  /* ---- Paciente ---- */
  const { rows: pac } = await pool.query<{
    nombre: string
    fecha_nacimiento: string | null
    documento_tipo: string | null
    documento_numero: string | null
    correo: string | null
    telefono: string | null
    numero_expediente: string | null
  }>(
    // to_char en la fecha sin hora: dejarla como `date` la emitiría como
    // instante de medianoche UTC y se mostraría un día antes.
    `select nombre,
            to_char(fecha_nacimiento, 'YYYY-MM-DD') as fecha_nacimiento,
            documento_tipo::text as documento_tipo,
            documento_numero, correo, telefono,
            numero_expediente::text as numero_expediente
       from paciente
      where id = $1 and clinica_id = $2
        and ($3::uuid is null or nutricionista_id = $3)`,
    [pacienteId, tenantId, restringirA],
  )
  const p = pac[0]
  if (!p) return null

  /* ---- Alergias y diagnósticos (perfil) ---- */
  let alergias: string[] = []
  let diagnosticos: string[] = []
  if (secciones.includes('perfil')) {
    const [ale, dia] = await Promise.all([
      pool.query<{ descripcion: string }>(
        `select descripcion from paciente_alergia
          where paciente_id = $1 and clinica_id = $2 order by descripcion`,
        [pacienteId, tenantId],
      ),
      pool.query<{ descripcion: string }>(
        `select descripcion from paciente_diagnostico
          where paciente_id = $1 and clinica_id = $2 and activo = true
          order by descripcion`,
        [pacienteId, tenantId],
      ),
    ])
    alergias = ale.rows.map((r) => r.descripcion)
    diagnosticos = dia.rows.map((r) => r.descripcion)
  }

  /* ---- Profesional que firma ---- */
  const { rows: prof } = await pool.query<{ nombre: string; colegiatura: string | null }>(
    'select nombre, colegiatura from profesional where id = $1 and clinica_id = $2',
    [profesionalId, tenantId],
  )

  /* ---- Plan activo ---- */
  let plan: PlanDatos | null = null
  if (secciones.includes('plan')) {
    const { rows: planes } = await pool.query<{
      id: string
      nombre: string
      objetivo: string | null
      fecha_inicio: string | null
      fecha_fin: string | null
    }>(
      // Solo el ACTIVO: un borrador no se ha prescrito y un archivado ya
      // no rige. Exportar cualquiera de los dos como "el plan" mentiría.
      `select id, nombre, objetivo,
              to_char(fecha_inicio,'YYYY-MM-DD') as fecha_inicio,
              to_char(fecha_fin,'YYYY-MM-DD')    as fecha_fin
         from plan_alimentario
        where paciente_id = $1 and clinica_id = $2 and estado = 'activo'
        limit 1`,
      [pacienteId, tenantId],
    )

    const cabecera = planes[0]
    if (cabecera) {
      const { rows: comidas } = await pool.query<{
        dia_semana: number
        tipo_comida: string
        descripcion: string
        calorias_kcal: number | null
      }>(
        // El ORDER BY va contra la columna del enum, no contra el alias
        // ::text: con el alias ordena alfabéticamente y el almuerzo sale
        // antes que el desayuno.
        `select pc.dia_semana, pc.tipo_comida::text as tipo_comida,
                pc.descripcion, pc.calorias_kcal
           from plan_comida pc
          where pc.plan_id = $1 and pc.clinica_id = $2
          order by pc.dia_semana, pc.tipo_comida`,
        [cabecera.id, tenantId],
      )

      const dias: PlanDatos['dias'] = {}
      for (const c of comidas) {
        ;(dias[String(c.dia_semana)] ??= []).push({
          tipoComida: c.tipo_comida,
          descripcion: c.descripcion,
          caloriasKcal: c.calorias_kcal,
        })
      }

      plan = {
        nombre: cabecera.nombre,
        objetivo: cabecera.objetivo,
        fechaInicio: cabecera.fecha_inicio,
        fechaFin: cabecera.fecha_fin,
        dias,
      }
    }
  }

  /* ---- Laboratorios ---- */
  // Se reutiliza el repositorio de la Rebanada 5: ya resuelve el rango
  // por sexo, el estado y la tendencia. Reimplementarlo aquí produciría
  // un documento que discrepa de la pantalla.
  let laboratorios: Estudio[] = []
  if (secciones.includes('laboratorios')) {
    laboratorios = (await listarEstudios(tenantId, restringirA, pacienteId)) ?? []
  }

  /* ---- Sociodemografía ---- */
  let sociodemografico: SocioDatos | null = null
  if (secciones.includes('sociodemografico')) {
    const { rows } = await pool.query<Record<string, unknown>>(
      // El consentimiento se comprueba AQUÍ, no en la plantilla. La
      // promesa hecha al paciente no puede depender de un `if` en la
      // capa de presentación.
      `select nivel_actividad::text as nivel_actividad, horas_sueno, tabaco,
              alcohol::text as alcohol, ocupacion, escolaridad::text as escolaridad,
              personas_en_hogar, tipo_hogar::text as tipo_hogar
         from paciente_sociodemografico
        where paciente_id = $1 and clinica_id = $2 and consentimiento_otorgado = true`,
      [pacienteId, tenantId],
    )
    const s = rows[0]
    if (s) {
      sociodemografico = {
        nivelActividad: (s['nivel_actividad'] as string | null) ?? null,
        horasSueno: (s['horas_sueno'] as number | null) ?? null,
        tabaco: (s['tabaco'] as boolean | null) ?? null,
        alcohol: (s['alcohol'] as string | null) ?? null,
        ocupacion: (s['ocupacion'] as string | null) ?? null,
        escolaridad: (s['escolaridad'] as string | null) ?? null,
        personasEnHogar: (s['personas_en_hogar'] as number | null) ?? null,
        tipoHogar: (s['tipo_hogar'] as string | null) ?? null,
      }
    }
  }

  const documento =
    p.documento_numero !== null
      ? `${ETIQUETA_DOCUMENTO[p.documento_tipo ?? ''] ?? ''} ${p.documento_numero}`.trim()
      : null

  return {
    clinica: {
      nombre: clinicaFila.nombre_comercial,
      logo: await logoIncrustado(clinicaFila.logo_ruta, clinicaFila.logo_mime),
      // El mismo valor por defecto que tokens.css y que la API de marca.
      colorPrimario: clinicaFila.color_primario ?? '#0E7C66',
    },
    paciente: {
      nombre: p.nombre,
      fechaNacimiento: p.fecha_nacimiento,
      edad: edadDe(p.fecha_nacimiento),
      documento,
      correo: p.correo,
      telefono: p.telefono,
      numeroExpediente: p.numero_expediente,
      alergias,
      diagnosticos,
    },
    profesional: {
      nombre: prof[0]?.nombre ?? '',
      colegiatura: prof[0]?.colegiatura ?? null,
    },
    plan,
    laboratorios,
    sociodemografico,
    notasProfesional,
    generadoEn: new Date().toLocaleDateString('es-CR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/Costa_Rica',
    }),
  }
}
