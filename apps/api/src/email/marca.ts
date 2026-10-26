/**
 * La marca de la clínica, para los correos — R54.
 *
 * Los correos de NutriSmart los manda la plataforma pero los firma la
 * clínica: el paciente reconoce a su nutricionista, no a un proveedor
 * de software. Hasta ahora cada correo llevaba el verde `#0E7C66`
 * escrito a mano; esto lo saca de `brand_config`, que es donde vive el
 * white-label desde la Rebanada 6.
 */
import { pool } from '../db.js'
import { config } from '../config.js'

export interface Marca {
  nombreClinica: string
  colorPrimario: string
  /** Absoluta y pública, o null. Ver abajo por qué puede faltar. */
  logoUrl: string | null
  /**
   * La zona horaria de la clínica (`clinica.zona_horaria`).
   *
   * Va aquí aunque no sea «marca» porque se lee de la misma fila y
   * porque sin ella no se puede escribir la hora de una cita. Formatear
   * en el huso del SERVIDOR daría una hora distinta según dónde corra
   * el contenedor, y una hora equivocada en un aviso de cita es peor
   * que no mandarlo.
   */
  zonaHoraria: string
}

/** El de fábrica, para cuando no hay fila o falla la consulta. */
export const MARCA_POR_DEFECTO: Marca = {
  nombreClinica: 'NutriSmart',
  colorPrimario: '#0E7C66',
  logoUrl: null,
  zonaHoraria: 'America/Costa_Rica',
}

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Lee la marca de una clínica.
 *
 * Nunca lanza. Un correo que no sale porque la consulta de la marca
 * falló es un correo perdido por un detalle estético; con la marca por
 * defecto sale igual y se entiende igual.
 *
 * ## Por qué el logo puede ser null aunque la clínica tenga uno
 *
 * El logo se sirve por `GET /api/brand/logo?clinica=…`, que es público
 * pero vive en la API. Para que Gmail pueda pedirlo hace falta una
 * dirección ABSOLUTA y alcanzable desde fuera, y eso es
 * `APP_PUBLIC_URL`. Sin esa variable —en desarrollo no se pone— la
 * única dirección que podríamos construir sería `http://localhost`, que
 * en el correo de alguien se ve como una imagen rota.
 *
 * Así que sin `APP_PUBLIC_URL` no hay logo y la cabecera cae al nombre
 * de la clínica en texto, que es lo que el diseño ya contempla.
 */
export async function obtenerMarca(clinicaId: string): Promise<Marca> {
  try {
    const { rows } = await pool.query<{
      clinica: string
      zona_horaria: string | null
      nombre_app: string | null
      color_primario: string | null
      logo_ruta: string | null
    }>(
      `select c.nombre_comercial as clinica, c.zona_horaria,
              b.nombre_app, b.color_primario, b.logo_ruta
         from clinica c
         left join brand_config b on b.clinica_id = c.id
        where c.id = $1`,
      [clinicaId],
    )

    const r = rows[0]
    if (!r) return MARCA_POR_DEFECTO

    const color =
      r.color_primario && HEX.test(r.color_primario)
        ? r.color_primario
        : MARCA_POR_DEFECTO.colorPrimario

    const base = config.wearables.urlPublica
    return {
      // `nombre_app` es cómo quiere llamarse la clínica dentro de la
      // aplicación; el comercial es el de reserva.
      nombreClinica: r.nombre_app ?? r.clinica,
      colorPrimario: color,
      logoUrl: r.logo_ruta && base ? `${base}/api/brand/logo?clinica=${clinicaId}` : null,
      zonaHoraria: r.zona_horaria ?? MARCA_POR_DEFECTO.zonaHoraria,
    }
  } catch (e) {
    console.error('[email] no se pudo leer la marca, se usa la de fábrica:', e)
    return MARCA_POR_DEFECTO
  }
}

/**
 * Un tono más oscuro del primario, para el borde de las cajas.
 *
 * Se calcula en vez de guardarse: `brand_config` tiene un solo color de
 * acción y pedirle a la clínica un segundo tono solo para un borde de
 * correo sería trabajo de configuración que nadie quiere hacer.
 */
export function aclarar(hex: string, alfa: number): string {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return `rgba(${n(1)},${n(3)},${n(5)},${alfa})`
}
