/**
 * El cascarón común de todos los correos — R54.
 *
 * ## Por qué tablas y estilos en línea, en 2026
 *
 * Porque Outlook de escritorio sigue dibujando el HTML con el motor de
 * Word. Ahí no hay flexbox, ni grid, ni `<style>` en el `<head>` que
 * sobreviva, ni `border-radius` fiable. Las tablas anidadas con
 * `style=` en cada celda son feas de escribir y son lo único que se ve
 * igual en Gmail, Outlook y Apple Mail.
 *
 * ## El escape va aquí y en un solo sitio
 *
 * Antes de R54 había cuatro copias de la misma función `esc()`, una por
 * módulo de correo. Todo lo que entra en estas plantillas lo escribe
 * una persona —el nombre del paciente, el de la clínica, el motivo de
 * una cancelación— y basta que una de las cuatro copias se quede corta
 * para que un `<` en un apellido rompa el correo.
 */
import { aclarar, type Marca } from './marca.js'

/** Escapa texto que va a parar dentro del HTML. */
export function esc(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Escapa una dirección que va en un `href` o un `src`.
 *
 * Aparte de `esc()` porque aquí lo que importa es otra cosa: que no
 * entre un `javascript:` ni un `data:`. Un enlace así en un correo no
 * hace nada en Gmail —desinfecta—, pero sí en un cliente de escritorio.
 * Solo se dejan pasar http y https; lo demás se queda sin enlace.
 */
export function escUrl(u: string): string {
  try {
    const url = new URL(u)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '#'
    return esc(url.toString())
  } catch {
    return '#'
  }
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

export function titulo(texto: string): string {
  return `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#141A17;font-weight:700;">${esc(texto)}</h1>`
}

/**
 * Un párrafo.
 *
 * `html` ya viene escapado por quien llama: es el único punto donde se
 * admite marcado, y hace falta para poner un `<strong>` alrededor de un
 * nombre. Quien lo use tiene que escapar lo que interpole.
 */
export function parrafo(html: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#333333;">${html}</p>`
}

export function nota(texto: string): string {
  return `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#8A8A8A;">${esc(texto)}</p>`
}

/**
 * La caja de datos: dos columnas, etiqueta y valor.
 *
 * Las filas con valor vacío se descartan aquí y no en cada plantilla,
 * que es como se cuelan las cajas con un «Motivo:» en blanco.
 */
export function caja(
  filas: { etiqueta: string; valor: string; destacado?: boolean }[],
  marca: Marca,
): string {
  const visibles = filas.filter((f) => f.valor.trim() !== '')
  if (visibles.length === 0) return ''

  const cuerpo = visibles
    .map(
      (f) => `<tr>
        <td style="padding:10px 14px;font-size:13px;color:#6B7280;width:38%;vertical-align:top;">${esc(f.etiqueta)}</td>
        <td style="padding:10px 14px;font-size:14px;color:#141A17;font-weight:${f.destacado ? '700' : '600'};">${esc(f.valor)}</td>
      </tr>`,
    )
    .join('')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="border-collapse:separate;border:1px solid ${aclarar(marca.colorPrimario, 0.25)};border-radius:6px;margin:16px 0;background:${aclarar(marca.colorPrimario, 0.04)};">
    ${cuerpo}
  </table>`
}

/**
 * El botón.
 *
 * Es un `<a>` con relleno y no un `<button>`: en un correo no hay
 * formulario que enviar, y Outlook no pinta los botones. El
 * `mso-padding-alt` y el `<!--[if mso]>` son lo que evita que ahí salga
 * como un enlace suelto sin caja.
 */
export function boton(href: string, etiqueta: string, color: string): string {
  const u = escUrl(href)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;">
    <tr><td align="center" bgcolor="${color}" style="border-radius:6px;mso-padding-alt:14px 28px;">
      <a href="${u}" style="display:inline-block;padding:14px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">${esc(etiqueta)}</a>
    </td></tr>
  </table>`
}

/* ------------------------------------------------------------------ */
/* El cascarón                                                         */
/* ------------------------------------------------------------------ */

export function envoltorio(marca: Marca, cuerpo: string): string {
  // El `color:#ffffff` del img no es decorativo: es el color del TEXTO
  // ALTERNATIVO. Gmail bloquea las imágenes hasta que el lector las
  // acepta, y entonces lo que se ve en la cabecera es el `alt`. Sin esa
  // regla sale en negro sobre el color de la clínica y, en un morado o
  // un azul oscuro, no se lee.
  const cabecera = marca.logoUrl
    ? `<img src="${escUrl(marca.logoUrl)}" alt="${esc(marca.nombreClinica)}" height="44"
         style="max-height:44px;max-width:180px;display:block;margin:0 auto;border:0;color:#ffffff;font-family:Arial,sans-serif;font-size:18px;font-weight:700;" />`
    : `<span style="font-size:20px;font-weight:700;color:#ffffff;">${esc(marca.nombreClinica)}</span>`

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${esc(marca.nombreClinica)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F6F5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6F5;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
      style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E6ECEA;">
      <tr><td align="center" style="background:${marca.colorPrimario};padding:24px 32px;">
        ${cabecera}
      </td></tr>
      <tr><td style="padding:32px 32px 24px;">
        ${cuerpo}
      </td></tr>
      <tr><td style="background:#F9FAFA;padding:16px 32px;text-align:center;border-top:1px solid #EEF2F1;">
        <p style="margin:0;color:#8A8A8A;font-size:12px;line-height:1.5;">
          Este correo te lo envía ${esc(marca.nombreClinica)} a través de NutriSmart.<br />
          Si tienes dudas sobre tu tratamiento, habla con tu nutricionista.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}
