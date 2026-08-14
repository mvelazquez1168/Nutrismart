/**
 * HTML del expediente exportable — CLI-05.
 *
 * Se genera HTML y lo imprime Chromium, en vez de componer el PDF con
 * una librería de dibujo: el documento tiene que llevar la marca de la
 * clínica, y describir esa portada en un DSL de coordenadas cuesta
 * mucho más que escribirla en CSS.
 *
 * Los colores de ESTADO CLÍNICO son fijos, como en la aplicación: un
 * valor alterado tiene que verse igual en pantalla y en papel, y en
 * todas las clínicas. Lo único que cambia con la marca es el color de
 * cabecera y de los títulos de sección.
 */
import type { DatosPDF, Seccion } from './datos.js'

const DIAS = [
  { numero: 1, corto: 'Lun' },
  { numero: 2, corto: 'Mar' },
  { numero: 3, corto: 'Mié' },
  { numero: 4, corto: 'Jue' },
  { numero: 5, corto: 'Vie' },
  { numero: 6, corto: 'Sáb' },
  { numero: 7, corto: 'Dom' },
] as const

const TIPOS = [
  { clave: 'desayuno', etiqueta: 'Desayuno' },
  { clave: 'media_manana', etiqueta: 'Media mañana' },
  { clave: 'almuerzo', etiqueta: 'Almuerzo' },
  { clave: 'merienda', etiqueta: 'Merienda' },
  { clave: 'cena', etiqueta: 'Cena' },
  { clave: 'extra', etiqueta: 'Extra' },
] as const

const ETIQUETA_ACTIVIDAD: Record<string, string> = {
  sedentario: 'Sedentario',
  leve: 'Leve',
  moderada: 'Moderada',
  intensa: 'Intensa',
}
const ETIQUETA_ALCOHOL: Record<string, string> = {
  nunca: 'Nunca',
  ocasional: 'Ocasional',
  frecuente: 'Frecuente',
}
const ETIQUETA_ESCOLARIDAD: Record<string, string> = {
  ninguna: 'Ninguna',
  primaria: 'Primaria',
  secundaria: 'Secundaria',
  tecnica: 'Técnica',
  universitaria: 'Universitaria',
  posgrado: 'Posgrado',
}
const ETIQUETA_HOGAR: Record<string, string> = {
  solo: 'Solo',
  pareja: 'En pareja',
  familia_nuclear: 'Familia nuclear',
  familia_extendida: 'Familia extendida',
  companeros: 'Compañeros',
}

/**
 * Escapa para HTML, incluidas las comillas.
 *
 * Sin escapar comillas, un valor que acabe dentro de un atributo
 * —el color de marca, por ejemplo— podría cerrarlo e inyectar
 * marcado. Todo el contenido de este documento sale de la base, y de
 * ahí lo pone un usuario.
 */
function esc(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Un color solo entra en el CSS si es #rrggbb. */
function colorSeguro(valor: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(valor) ? valor : '#0E7C66'
}

/** 'AAAA-MM-DD' → '17/08/2026', sin pasar por Date. */
function fecha(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return a && m && d ? `${d}/${m}/${a}` : iso
}

function filaDato(etiqueta: string, valor: string | null): string {
  if (!valor) return ''
  return `<tr><td class="campo">${esc(etiqueta)}</td><td>${esc(valor)}</td></tr>`
}

function seccionPerfil(d: DatosPDF): string {
  const p = d.paciente
  const filas = [
    filaDato('Expediente', p.numeroExpediente ? `#${p.numeroExpediente}` : null),
    filaDato('Documento', p.documento),
    filaDato('Fecha de nacimiento', p.fechaNacimiento ? fecha(p.fechaNacimiento) : null),
    filaDato('Teléfono', p.telefono),
    filaDato('Correo', p.correo),
  ].join('')

  // La sección se pinta aunque no haya alergias: el teléfono y el
  // documento valen por sí solos. Condicionarla a las alergias dejaría
  // fuera todo lo demás cuando el paciente no tiene ninguna.
  if (!filas && p.alergias.length === 0 && p.diagnosticos.length === 0) return ''

  return `
  <section class="seccion">
    <h2>Información del paciente</h2>
    ${filas ? `<table class="datos"><tbody>${filas}</tbody></table>` : ''}
    ${
      p.diagnosticos.length > 0
        ? `<div class="lista"><span class="lista-titulo">Diagnósticos activos</span>
             <ul>${p.diagnosticos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`
        : ''
    }
    ${
      p.alergias.length > 0
        ? `<div class="lista alerta"><span class="lista-titulo">Alergias e intolerancias</span>
             <ul>${p.alergias.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`
        : ''
    }
  </section>`
}

function seccionPlan(plan: NonNullable<DatosPDF['plan']>): string {
  const mapa = new Map<string, { descripcion: string; caloriasKcal: number | null }>()
  for (const [dia, comidas] of Object.entries(plan.dias)) {
    for (const c of comidas) mapa.set(`${dia}_${c.tipoComida}`, c)
  }

  const filas = TIPOS.filter((t) => DIAS.some((d) => mapa.has(`${d.numero}_${t.clave}`)))
  if (filas.length === 0) return ''

  const cuerpo = filas
    .map((t) => {
      const celdas = DIAS.map((d) => {
        const c = mapa.get(`${d.numero}_${t.clave}`)
        if (!c) return '<td class="vacia"></td>'
        return `<td class="llena">
          <div>${esc(c.descripcion)}</div>
          ${c.caloriasKcal ? `<div class="kcal">${esc(c.caloriasKcal)} kcal</div>` : ''}
        </td>`
      }).join('')
      return `<tr><th class="tipo">${esc(t.etiqueta)}</th>${celdas}</tr>`
    })
    .join('')

  const rango = [
    plan.fechaInicio ? `Desde ${fecha(plan.fechaInicio)}` : '',
    plan.fechaFin ? `hasta ${fecha(plan.fechaFin)}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return `
  <section class="seccion">
    <h2>Plan de alimentación</h2>
    <p class="plan-nombre">${esc(plan.nombre)}</p>
    ${plan.objetivo ? `<p class="sub">Objetivo: ${esc(plan.objetivo)}</p>` : ''}
    ${rango ? `<p class="sub tenue">${esc(rango)}</p>` : ''}
    <table class="plan">
      <thead>
        <tr><th class="tipo">Comida</th>${DIAS.map((d) => `<th>${d.corto}</th>`).join('')}</tr>
      </thead>
      <tbody>${cuerpo}</tbody>
    </table>
  </section>`
}

function seccionLaboratorios(estudios: DatosPDF['laboratorios']): string {
  if (estudios.length === 0) return ''

  const bloques = estudios
    .map((e) => {
      if (e.resultados.length === 0) {
        return `<div class="lab">
          <p class="lab-cabecera">${fecha(e.fecha)}${e.laboratorio ? ` · ${esc(e.laboratorio)}` : ''}</p>
          <p class="sub tenue">Sin valores capturados; el informe original está en el expediente digital.</p>
        </div>`
      }

      const filas = e.resultados
        .map((r) => {
          const rango =
            r.rango && (r.rango.minimo !== null || r.rango.maximo !== null)
              ? `${r.rango.minimo ?? ''} – ${r.rango.maximo ?? ''}`
              : '—'
          // Los estados clínicos NO se re-tematizan: el mismo color en
          // pantalla, en papel y en cualquier clínica.
          const clase =
            r.estado === 'alterado'
              ? 'alterado'
              : r.estado === 'normal'
                ? 'normal'
                : 'sin-referencia'
          const texto =
            r.estado === 'alterado'
              ? 'Alterado'
              : r.estado === 'normal'
                ? 'Normal'
                : 'Sin referencia'
          return `<tr>
            <td>${esc(r.nombre)}</td>
            <td class="num">${esc(r.valor)} ${esc(r.unidad)}</td>
            <td class="num tenue">${esc(rango)}</td>
            <td><span class="estado ${clase}">${texto}</span></td>
          </tr>`
        })
        .join('')

      return `<div class="lab">
        <p class="lab-cabecera">${fecha(e.fecha)}${e.laboratorio ? ` · ${esc(e.laboratorio)}` : ''}</p>
        <table class="datos">
          <thead><tr><th>Biomarcador</th><th class="num">Valor</th><th class="num">Referencia</th><th>Estado</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`
    })
    .join('')

  return `
  <section class="seccion">
    <h2>Resultados de laboratorio</h2>
    <p class="sub tenue">
      «Alterado» significa que el valor queda fuera del rango de referencia declarado por la
      clínica. No es un diagnóstico.
    </p>
    ${bloques}
  </section>`
}

function seccionSocio(s: NonNullable<DatosPDF['sociodemografico']>): string {
  const filas = [
    filaDato('Nivel de actividad física', s.nivelActividad ? ETIQUETA_ACTIVIDAD[s.nivelActividad] ?? null : null),
    filaDato('Horas de sueño', s.horasSueno !== null ? `${s.horasSueno} h por noche` : null),
    filaDato('Tabaco', s.tabaco === null ? null : s.tabaco ? 'Fumador activo' : 'No fuma'),
    filaDato('Consumo de alcohol', s.alcohol ? ETIQUETA_ALCOHOL[s.alcohol] ?? null : null),
    filaDato('Ocupación', s.ocupacion),
    filaDato('Escolaridad', s.escolaridad ? ETIQUETA_ESCOLARIDAD[s.escolaridad] ?? null : null),
    filaDato('Personas en el hogar', s.personasEnHogar !== null ? String(s.personasEnHogar) : null),
    filaDato('Tipo de hogar', s.tipoHogar ? ETIQUETA_HOGAR[s.tipoHogar] ?? null : null),
  ].join('')

  if (!filas) return ''

  return `
  <section class="seccion">
    <h2>Contexto social</h2>
    <p class="sub tenue">Recopilado con el consentimiento expreso del paciente.</p>
    <table class="datos"><tbody>${filas}</tbody></table>
  </section>`
}

export function generarHTML(datos: DatosPDF, secciones: Seccion[]): string {
  const primario = colorSeguro(datos.clinica.colorPrimario)
  const p = datos.paciente

  const meta = [
    p.edad !== null ? `${p.edad} años` : '',
    p.documento ?? '',
    p.numeroExpediente ? `Expediente #${p.numeroExpediente}` : '',
  ]
    .filter(Boolean)
    .map(esc)
    .join(' · ')

  const cuerpo = [
    secciones.includes('perfil') ? seccionPerfil(datos) : '',
    secciones.includes('plan') && datos.plan ? seccionPlan(datos.plan) : '',
    secciones.includes('laboratorios') ? seccionLaboratorios(datos.laboratorios) : '',
    secciones.includes('sociodemografico') && datos.sociodemografico
      ? seccionSocio(datos.sociodemografico)
      : '',
    datos.notasProfesional
      ? `<section class="seccion">
           <h2>Estrategia y recomendaciones</h2>
           <div class="notas">${esc(datos.notasProfesional)}</div>
         </section>`
      : '',
  ]
    .filter(Boolean)
    .join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Expediente · ${esc(p.nombre)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  /* Pila del sistema: el PDF se imprime en un Chromium sin fuentes
     instaladas, así que pedir una tipografía de marca daría un
     sustituto impredecible. */
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #141A17; font-size: 11.5px; line-height: 1.45; background: #fff;
  }

  .banda {
    background: ${primario}; color: #fff;
    padding: 24px 32px;
    display: flex; align-items: center; justify-content: space-between; gap: 20px;
  }
  .banda .clinica { font-size: 17px; font-weight: 700; }
  .banda .tipo-doc { font-size: 11px; opacity: .85; margin-top: 2px; }
  .banda img { max-height: 44px; max-width: 130px; object-fit: contain; }

  .paciente {
    border-bottom: 1px solid #E6ECEA; background: #F7FAF9;
    padding: 14px 32px;
    display: flex; align-items: flex-start; justify-content: space-between; gap: 20px;
  }
  .paciente .nombre { font-size: 16px; font-weight: 700; }
  .paciente .meta { font-size: 11px; color: #6B7280; margin-top: 2px; }
  .paciente .emision { font-size: 10.5px; color: #6B7280; text-align: right; white-space: nowrap; }

  .contenido { padding: 22px 32px 0; }

  /* Una sección no se parte entre páginas si cabe entera. */
  .seccion { margin-bottom: 22px; page-break-inside: avoid; }
  .seccion h2 {
    font-size: 12px; font-weight: 700; color: ${primario};
    text-transform: uppercase; letter-spacing: .05em;
    border-bottom: 2px solid ${primario}; padding-bottom: 4px; margin-bottom: 10px;
  }

  .sub { font-size: 11px; color: #6B7280; margin-bottom: 2px; }
  .tenue { color: #9AA6A1; }

  table { width: 100%; border-collapse: collapse; }
  .datos { font-size: 11px; }
  .datos th {
    background: #F4F8F6; text-align: left; padding: 5px 8px;
    font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em;
    color: #6B7280; border-bottom: 1px solid #E6ECEA;
  }
  .datos td { padding: 5px 8px; border-bottom: 1px solid #F0F4F2; }
  .datos tr:last-child td { border-bottom: none; }
  .campo { font-weight: 600; width: 180px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }

  .lista { margin-top: 8px; }
  .lista-titulo {
    display: block; font-size: 9.5px; text-transform: uppercase;
    letter-spacing: .04em; color: #6B7280; margin-bottom: 3px;
  }
  .lista ul { list-style: none; display: flex; flex-wrap: wrap; gap: 5px; }
  .lista li {
    background: #F4F8F6; border-radius: 999px; padding: 2px 9px; font-size: 10.5px;
  }
  .lista.alerta li { background: rgba(232,147,12,.14); color: #8A5606; }

  .plan-nombre { font-size: 12.5px; font-weight: 600; }
  .plan { font-size: 9.5px; margin-top: 8px; table-layout: fixed; }
  .plan th {
    background: #F4F8F6; text-align: center; padding: 4px 3px;
    font-size: 9px; font-weight: 700; color: #6B7280; border: 1px solid #E6ECEA;
  }
  .plan th.tipo { text-align: left; width: 66px; }
  .plan td { border: 1px solid #E6ECEA; padding: 3px 4px; vertical-align: top; }
  .plan td.llena { background: #FBFDFC; }
  .plan td.vacia { background: #FAFBFA; }
  .plan .kcal { color: #9AA6A1; font-size: 8.5px; margin-top: 1px; }

  .lab { margin-bottom: 12px; }
  .lab-cabecera { font-size: 11px; font-weight: 600; margin-bottom: 4px; }

  /* Estados clínicos FIJOS: no siguen la marca de la clínica. */
  .estado {
    display: inline-block; border-radius: 999px;
    padding: 1px 7px; font-size: 9.5px; font-weight: 600;
  }
  .estado.normal { color: #0CA30C; background: rgba(12,163,12,.14); }
  .estado.alterado { color: #D03B3B; background: rgba(208,59,59,.14); }
  .estado.sin-referencia { color: #6B7280; background: #F4F8F6; }

  .notas {
    background: #F4F8F6; border-left: 3px solid ${primario};
    padding: 11px 14px; font-size: 11.5px; white-space: pre-wrap;
  }

  .pie {
    margin: 26px 32px 0; padding: 12px 0 0;
    border-top: 1px solid #E6ECEA;
    display: flex; justify-content: space-between; align-items: flex-end;
    font-size: 9.5px; color: #9AA6A1;
  }
  .pie .firma { text-align: right; color: #141A17; }
  .pie .firma strong { display: block; font-size: 11px; }
</style>
</head>
<body>

<div class="banda">
  <div>
    <div class="clinica">${esc(datos.clinica.nombre)}</div>
    <div class="tipo-doc">Expediente clínico nutricional</div>
  </div>
  ${datos.clinica.logo ? `<img src="${datos.clinica.logo}" alt="">` : ''}
</div>

<div class="paciente">
  <div>
    <div class="nombre">${esc(p.nombre)}</div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
  </div>
  <div class="emision">
    Emitido el ${esc(datos.generadoEn)}<br>
    ${esc(datos.profesional.nombre)}
  </div>
</div>

<div class="contenido">${cuerpo}</div>

<div class="pie">
  <div>Documento confidencial · contiene datos de salud</div>
  <div class="firma">
    <strong>${esc(datos.profesional.nombre)}</strong>
    ${datos.profesional.colegiatura ? `Colegiatura ${esc(datos.profesional.colegiatura)}` : ''}
  </div>
</div>

</body>
</html>`
}
