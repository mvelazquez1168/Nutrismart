Lee docs/REBANADA-09.md para entender el contexto del proyecto. Esta es la
Rebanada 10: generación y exportación de PDF del expediente clínico (CLI-05).

────────────────────────────────────────────────────────────
ANTES DE ESCRIBIR CUALQUIER CÓDIGO — leer estas referencias
────────────────────────────────────────────────────────────

1. Lee apps/api/src/server.ts — confirma cómo se registran rutas y el patrón
   de auth (requireAuth, tenantId, resolverAlcance).
2. Lee apps/api/src/routes/planes.ts (que acabas de crear en R9) — úsalo como
   plantilla de ruta para este módulo.
3. Lee apps/api/src/almacen/ (o src/almacen/) — entiende cómo el proyecto
   almacena archivos (AlmacenArchivos). Usarás esta interfaz para guardar el PDF.
4. Lee apps/api/migrations/ — confirma que la última migración es 011. La tuya
   será 012_pdf_export.sql.
5. Lee apps/web-professional/src/pages/PacienteFicha.tsx — necesitas agregar
   el botón "Exportar PDF" en el encabezado del expediente.
6. Lee apps/api/src/routes/admin.ts o brand.ts — busca cómo se lee brand_config
   para extraer el logo y colores de la clínica. Los usarás en la portada del PDF.
7. Verifica si el proyecto ya tiene Puppeteer instalado:
   cat apps/api/package.json | grep -i puppet
   Si NO está: npm install puppeteer --prefix apps/api
   Si el entorno no permite Chromium (Docker sin Chromium), instala en su lugar:
   npm install pdfmake --prefix apps/api
   Decide según lo que encuentres. El prompt incluye ambas implementaciones.

────────────────────────────────────────────────────────────
PASO 1 — MIGRACIÓN
────────────────────────────────────────────────────────────

Archivo: apps/api/migrations/012_pdf_export.sql

```sql
-- migration: 012_pdf_export

CREATE TABLE pdf_export (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id       UUID        NOT NULL REFERENCES clinica(id),
  paciente_id      UUID        NOT NULL REFERENCES paciente(id),
  profesional_id   UUID        NOT NULL REFERENCES profesional(id),
  secciones        JSONB       NOT NULL DEFAULT '[]',
  -- qué secciones se incluyeron, ej: ["perfil","plan","laboratorios"]
  archivo_nombre   TEXT,
  -- nombre del archivo generado, ej: "Reporte_Ana_Lopez_20260814.pdf"
  archivo_tamano   INTEGER,   -- bytes
  archivo_url      TEXT,      -- ruta o URL del archivo almacenado
  enviado_paciente BOOLEAN    NOT NULL DEFAULT false,
  enviado_en       TIMESTAMPTZ,
  notas_profesional TEXT,     -- estrategia / recomendaciones opcionales del profesional
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdf_export_paciente
  ON pdf_export (clinica_id, paciente_id, created_at DESC);
```

Ejecuta npm run migrate en apps/api y confirma que la tabla existe.

────────────────────────────────────────────────────────────
PASO 2 — GENERADOR DE PDF (apps/api/src/pdf/)
────────────────────────────────────────────────────────────

Crea el directorio apps/api/src/pdf/ con dos archivos:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2A — apps/api/src/pdf/datos.ts
    Funciones para recopilar los datos del expediente desde la DB.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

```typescript
// Adapta los imports de db al patrón real del proyecto
import { db } from '../db'; // ajusta según la ruta real

export interface DatosPDF {
  clinica: { nombre: string; logo_url: string | null; color_primario: string };
  paciente: {
    id: string; nombre: string; fecha_nacimiento: string | null;
    cedula: string | null; correo: string | null; telefono: string | null;
    alergias: string | null;
  };
  profesional: { nombre: string; colegiatura: string | null };
  plan: PlanDatos | null;
  laboratorios: LabDatos[];
  sociodemografico: SocioDatos | null;
  notas_profesional: string;
  generado_en: string;
}

export interface PlanDatos {
  nombre: string;
  objetivo: string | null;
  fecha_inicio: string | null;
  dias: Record<string, Array<{
    tipo_comida: string;
    descripcion: string;
    calorias_kcal: number | null;
  }>>;
}

export interface LabDatos {
  id: string;
  nombre: string;
  archivo_url: string | null;
  created_at: string;
}

export interface SocioDatos {
  nivel_actividad: string | null;
  horas_sueno: number | null;
  tabaco: boolean | null;
  alcohol: string | null;
  ocupacion: string | null;
  escolaridad: string | null;
  personas_en_hogar: number | null;
  tipo_hogar: string | null;
}

export async function recopilarDatosPDF(
  pacienteId: string,
  clinicaId: string,
  profesionalId: string,
  secciones: string[],
  notasProfesional: string
): Promise<DatosPDF> {

  // Datos básicos de clínica (brand_config si existe, si no, nombre de la tabla clinica)
  const clinicaRes = await db.query(
    `SELECT c.nombre,
            COALESCE(b.logo_url, '') AS logo_url,
            COALESCE(b.color_primario, '#0E7C66') AS color_primario
     FROM clinica c
     LEFT JOIN brand_config b ON b.clinica_id = c.id
     WHERE c.id = $1`,
    [clinicaId]
  );
  const clinica = clinicaRes.rows[0] ?? { nombre: '', logo_url: null, color_primario: '#0E7C66' };

  // Datos del paciente — adapta nombres de columnas según el schema real
  const pacienteRes = await db.query(
    `SELECT id, nombre, fecha_nacimiento, cedula, correo, telefono, alergias
     FROM paciente WHERE id = $1 AND clinica_id = $2`,
    [pacienteId, clinicaId]
  );
  const paciente = pacienteRes.rows[0];

  // Profesional
  const profRes = await db.query(
    `SELECT nombre, colegiatura FROM profesional WHERE id = $1`,
    [profesionalId]
  );
  const profesional = profRes.rows[0] ?? { nombre: '', colegiatura: null };

  // Plan alimentario activo (solo si sección seleccionada)
  let plan: PlanDatos | null = null;
  if (secciones.includes('plan')) {
    const planRes = await db.query(
      `SELECT pa.nombre, pa.objetivo, pa.fecha_inicio,
              pc.dia_semana, pc.tipo_comida, pc.descripcion, pc.calorias_kcal
       FROM plan_alimentario pa
       LEFT JOIN plan_comida pc ON pc.plan_id = pa.id
       WHERE pa.paciente_id = $1 AND pa.clinica_id = $2 AND pa.estado = 'activo'
       ORDER BY pc.dia_semana, pc.tipo_comida
       LIMIT 200`,
      [pacienteId, clinicaId]
    );
    if (planRes.rows.length > 0) {
      const primera = planRes.rows[0];
      const dias: PlanDatos['dias'] = {};
      for (const row of planRes.rows) {
        if (row.tipo_comida) {
          if (!dias[row.dia_semana]) dias[row.dia_semana] = [];
          dias[row.dia_semana].push({
            tipo_comida: row.tipo_comida,
            descripcion: row.descripcion,
            calorias_kcal: row.calorias_kcal,
          });
        }
      }
      plan = { nombre: primera.nombre, objetivo: primera.objetivo, fecha_inicio: primera.fecha_inicio, dias };
    }
  }

  // Laboratorios (solo si sección seleccionada)
  let laboratorios: LabDatos[] = [];
  if (secciones.includes('laboratorios')) {
    const labRes = await db.query(
      `SELECT id, nombre, archivo_url, created_at
       FROM lab_exam
       WHERE paciente_id = $1 AND clinica_id = $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [pacienteId, clinicaId]
    );
    laboratorios = labRes.rows;
  }

  // Sociodemografía (solo si sección seleccionada y consentimiento activo)
  let sociodemografico: SocioDatos | null = null;
  if (secciones.includes('sociodemografico')) {
    const socioRes = await db.query(
      `SELECT nivel_actividad, horas_sueno, tabaco, alcohol,
              ocupacion, escolaridad, personas_en_hogar, tipo_hogar
       FROM paciente_sociodemografico
       WHERE paciente_id = $1 AND consentimiento_otorgado = true`,
      [pacienteId]
    );
    sociodemografico = socioRes.rows[0] ?? null;
  }

  return {
    clinica,
    paciente,
    profesional,
    plan,
    laboratorios,
    sociodemografico,
    notas_profesional: notasProfesional,
    generado_en: new Date().toLocaleDateString('es-CR', {
      year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'America/Costa_Rica'
    }),
  };
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2B — apps/api/src/pdf/template.ts
    Genera el HTML del PDF a partir de los datos.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

```typescript
import type { DatosPDF } from './datos';

const DIAS_LABEL: Record<string, string> = {
  '1': 'Lun', '2': 'Mar', '3': 'Mié',
  '4': 'Jue', '5': 'Vie', '6': 'Sáb', '7': 'Dom',
};

const TIPOS_LABEL: Record<string, string> = {
  desayuno: 'Desayuno', media_manana: 'Med. mañana',
  almuerzo: 'Almuerzo', merienda: 'Merienda',
  cena: 'Cena', extra: 'Extra',
};

const TIPOS_ORDEN = ['desayuno','media_manana','almuerzo','merienda','cena','extra'];

function esc(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function seccionPlan(plan: NonNullable<DatosPDF['plan']>): string {
  // Construir mapa: "dia_tipo" → descripcion + kcal
  const mapa: Record<string, { descripcion: string; calorias_kcal: number | null }> = {};
  for (const [dia, comidas] of Object.entries(plan.dias)) {
    for (const c of comidas) {
      mapa[`${dia}_${c.tipo_comida}`] = c;
    }
  }

  // Solo mostrar tipos que tienen al menos una celda
  const tiposVisibles = TIPOS_ORDEN.filter(t =>
    [1,2,3,4,5,6,7].some(d => mapa[`${d}_${t}`])
  );

  let rows = '';
  for (const tipo of tiposVisibles) {
    rows += `<tr><td class="tipo-label">${esc(TIPOS_LABEL[tipo])}</td>`;
    for (let d = 1; d <= 7; d++) {
      const c = mapa[`${d}_${tipo}`];
      if (c) {
        rows += `<td class="celda-llena">
          <div class="celda-desc">${esc(c.descripcion)}</div>
          ${c.calorias_kcal ? `<div class="celda-kcal">${c.calorias_kcal} kcal</div>` : ''}
        </td>`;
      } else {
        rows += `<td class="celda-vacia"></td>`;
      }
    }
    rows += '</tr>';
  }

  return `
  <div class="seccion">
    <div class="seccion-titulo">Plan de alimentación</div>
    <div class="plan-nombre">${esc(plan.nombre)}</div>
    ${plan.objetivo ? `<div class="plan-objetivo">Objetivo: ${esc(plan.objetivo)}</div>` : ''}
    ${plan.fecha_inicio ? `<div class="plan-fecha">Desde: ${new Date(plan.fecha_inicio + 'T00:00:00').toLocaleDateString('es-CR')}</div>` : ''}
    <table class="plan-tabla">
      <thead>
        <tr>
          <th class="tipo-header">Comida</th>
          ${[1,2,3,4,5,6,7].map(d => `<th>${DIAS_LABEL[String(d)]}</th>`).join('')}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function seccionLabs(labs: DatosPDF['laboratorios']): string {
  if (!labs.length) return '';
  const filas = labs.map(l => `
    <tr>
      <td>${esc(l.nombre)}</td>
      <td>${new Date(l.created_at).toLocaleDateString('es-CR')}</td>
    </tr>`).join('');
  return `
  <div class="seccion">
    <div class="seccion-titulo">Resultados de laboratorio</div>
    <table class="datos-tabla">
      <thead><tr><th>Examen</th><th>Fecha</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <p class="disclaimer-lab">Los archivos de laboratorio originales están disponibles en el expediente digital.</p>
  </div>`;
}

function seccionSocio(s: NonNullable<DatosPDF['sociodemografico']>): string {
  const ACTIVIDAD: Record<string, string> = {
    sedentario: 'Sedentario', leve: 'Leve', moderada: 'Moderada', intensa: 'Intensa',
  };
  const ALCOHOL: Record<string, string> = {
    nunca: 'Nunca', ocasional: 'Ocasional', frecuente: 'Frecuente',
  };
  const ESCOLARIDAD: Record<string, string> = {
    ninguna: 'Ninguna', primaria: 'Primaria', secundaria: 'Secundaria',
    tecnica: 'Técnica', universitaria: 'Universitaria', posgrado: 'Posgrado',
  };
  const HOGAR: Record<string, string> = {
    solo: 'Solo/a', pareja: 'En pareja', familia_nuclear: 'Familia nuclear',
    familia_extendida: 'Familia extendida', companeros: 'Con compañeros',
  };

  const datos = [
    ['Nivel de actividad física', s.nivel_actividad ? ACTIVIDAD[s.nivel_actividad] : null],
    ['Horas de sueño', s.horas_sueno != null ? `${s.horas_sueno} h/noche` : null],
    ['Tabaco', s.tabaco != null ? (s.tabaco ? 'Sí, fumador activo' : 'No') : null],
    ['Consumo de alcohol', s.alcohol ? ALCOHOL[s.alcohol] : null],
    ['Ocupación', s.ocupacion],
    ['Escolaridad', s.escolaridad ? ESCOLARIDAD[s.escolaridad] : null],
    ['Personas en el hogar', s.personas_en_hogar != null ? String(s.personas_en_hogar) : null],
    ['Tipo de hogar', s.tipo_hogar ? HOGAR[s.tipo_hogar] : null],
  ].filter(([, v]) => v != null);

  const filas = datos.map(([k, v]) =>
    `<tr><td class="campo-label">${esc(k as string)}</td><td>${esc(v as string)}</td></tr>`
  ).join('');

  return `
  <div class="seccion">
    <div class="seccion-titulo">Contexto sociodemográfico</div>
    <p class="disclaimer-lab">Datos recopilados con consentimiento expreso del paciente.</p>
    <table class="datos-tabla">
      <tbody>${filas}</tbody>
    </table>
  </div>`;
}

export function generarHTML(datos: DatosPDF, secciones: string[]): string {
  const primary = esc(datos.clinica.color_primario) || '#0E7C66';
  const paciente = datos.paciente;

  const edadStr = paciente.fecha_nacimiento
    ? (() => {
        const hoy = new Date();
        const nac = new Date(paciente.fecha_nacimiento);
        let edad = hoy.getFullYear() - nac.getFullYear();
        const m = hoy.getMonth() - nac.getMonth();
        if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
        return `${edad} años`;
      })()
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #1F2937; font-size: 12px; line-height: 1.5;
    background: #fff;
  }

  /* PORTADA */
  .header-band {
    background: ${primary};
    padding: 28px 36px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .header-clinica { color: #fff; }
  .header-clinica .nombre { font-size: 18px; font-weight: 700; }
  .header-clinica .sub { font-size: 12px; opacity: .8; margin-top: 2px; }
  .header-logo { max-height: 48px; max-width: 140px; object-fit: contain; }

  .paciente-band {
    background: #E7F1EE; padding: 16px 36px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .paciente-nombre { font-size: 20px; font-weight: 700; color: #0A5C4C; }
  .paciente-meta { font-size: 12px; color: #6B7280; margin-top: 3px; }
  .generado { font-size: 11px; color: #6B7280; text-align: right; }

  /* SECCIONES */
  .body-content { padding: 28px 36px; }
  .seccion { margin-bottom: 28px; page-break-inside: avoid; }
  .seccion-titulo {
    font-size: 14px; font-weight: 700; color: ${primary};
    border-bottom: 2px solid ${primary};
    padding-bottom: 5px; margin-bottom: 12px;
    text-transform: uppercase; letter-spacing: .05em;
  }

  /* TABLAS GENÉRICAS */
  .datos-tabla { width: 100%; border-collapse: collapse; font-size: 12px; }
  .datos-tabla th {
    background: #F6F9F8; text-align: left; padding: 7px 10px;
    font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em;
    color: #6B7280; border-bottom: 1px solid #E3EAE8; font-weight: 700;
  }
  .datos-tabla td { padding: 7px 10px; border-bottom: 1px solid #EFF3F2; }
  .datos-tabla tr:last-child td { border-bottom: none; }
  .campo-label { font-weight: 600; color: #374151; width: 200px; }

  /* PLAN DE COMIDAS */
  .plan-nombre { font-size: 14px; font-weight: 600; color: #0A5C4C; margin-bottom: 4px; }
  .plan-objetivo { font-size: 12px; color: #6B7280; margin-bottom: 2px; }
  .plan-fecha { font-size: 11px; color: #9CA3AF; margin-bottom: 10px; }
  .plan-tabla { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
  .plan-tabla th {
    background: #F6F9F8; text-align: center; padding: 6px 4px;
    font-size: 10.5px; font-weight: 700; color: #6B7280;
    border: 1px solid #E3EAE8;
  }
  .tipo-header { text-align: left; width: 80px; }
  .tipo-label { font-weight: 600; color: #374151; padding: 5px 6px;
    border: 1px solid #E3EAE8; background: #F6F9F8; }
  .celda-llena {
    background: #E7F1EE; padding: 4px 5px;
    border: 1px solid #E3EAE8; vertical-align: top;
  }
  .celda-vacia { background: #FAFAFA; border: 1px solid #E3EAE8; min-height: 30px; }
  .celda-desc { color: #1F2937; line-height: 1.3; }
  .celda-kcal { color: #6B7280; font-size: 10px; margin-top: 2px; }

  /* NOTAS */
  .notas-box {
    background: #F6F9F8; border-left: 4px solid ${primary};
    border-radius: 0 8px 8px 0; padding: 14px 18px;
    font-size: 12.5px; color: #1F2937; white-space: pre-wrap;
  }

  /* PIE */
  .footer-band {
    background: #F6F9F8; border-top: 1px solid #E3EAE8;
    padding: 14px 36px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 10.5px; color: #9CA3AF;
    margin-top: 32px;
  }
  .firma { text-align: right; }
  .firma strong { display: block; color: #1F2937; font-size: 12px; }

  .disclaimer-lab { font-size: 11px; color: #9CA3AF; font-style: italic; margin-bottom: 8px; }

  @media print {
    .seccion { page-break-inside: avoid; }
    .plan-tabla { font-size: 10px; }
  }
</style>
</head>
<body>

<!-- ENCABEZADO CON MARCA DE CLÍNICA -->
<div class="header-band">
  <div class="header-clinica">
    <div class="nombre">${esc(datos.clinica.nombre)}</div>
    <div class="sub">Expediente clínico nutricional</div>
  </div>
  ${datos.clinica.logo_url
    ? `<img class="header-logo" src="${esc(datos.clinica.logo_url)}" alt="Logo clínica">`
    : ''
  }
</div>

<!-- BANDA DE PACIENTE -->
<div class="paciente-band">
  <div>
    <div class="paciente-nombre">${esc(paciente.nombre)}</div>
    <div class="paciente-meta">
      ${[edadStr, paciente.cedula ? `Cédula: ${esc(paciente.cedula)}` : '', esc(paciente.correo)].filter(Boolean).join(' · ')}
    </div>
  </div>
  <div class="generado">
    Generado el ${esc(datos.generado_en)}<br>
    Prof. ${esc(datos.profesional.nombre)}
    ${datos.profesional.colegiatura ? `· Colegiatura ${esc(datos.profesional.colegiatura)}` : ''}
  </div>
</div>

<div class="body-content">

  ${secciones.includes('perfil') && paciente.alergias ? `
  <div class="seccion">
    <div class="seccion-titulo">Información del paciente</div>
    <table class="datos-tabla">
      <tbody>
        ${paciente.telefono ? `<tr><td class="campo-label">Teléfono</td><td>${esc(paciente.telefono)}</td></tr>` : ''}
        ${paciente.alergias ? `<tr><td class="campo-label">Alergias</td><td>${esc(paciente.alergias)}</td></tr>` : ''}
      </tbody>
    </table>
  </div>` : ''}

  ${secciones.includes('plan') && datos.plan ? seccionPlan(datos.plan) : ''}

  ${secciones.includes('laboratorios') && datos.laboratorios.length > 0 ? seccionLabs(datos.laboratorios) : ''}

  ${secciones.includes('sociodemografico') && datos.sociodemografico ? seccionSocio(datos.sociodemografico) : ''}

  ${datos.notas_profesional ? `
  <div class="seccion">
    <div class="seccion-titulo">Estrategia y recomendaciones</div>
    <div class="notas-box">${esc(datos.notas_profesional)}</div>
  </div>` : ''}

</div>

<!-- PIE DE PÁGINA -->
<div class="footer-band">
  <div>Documento confidencial · Solo para uso autorizado</div>
  <div class="firma">
    <strong>${esc(datos.profesional.nombre)}</strong>
    ${datos.profesional.colegiatura ? `Colegiatura ${esc(datos.profesional.colegiatura)}` : ''}
  </div>
</div>

</body>
</html>`;
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2C — apps/api/src/pdf/generar.ts
    Convierte el HTML a PDF. Usa Puppeteer si está disponible;
    si no, devuelve el HTML directamente para que el browser lo imprima.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

```typescript
import { generarHTML } from './template';
import type { DatosPDF } from './datos';

export type ResultadoPDF =
  | { tipo: 'pdf'; buffer: Buffer; contentType: 'application/pdf' }
  | { tipo: 'html'; html: string; contentType: 'text/html' };

export async function generarPDF(datos: DatosPDF, secciones: string[]): Promise<ResultadoPDF> {
  const html = generarHTML(datos, secciones);

  // Intentar Puppeteer
  try {
    // Dynamic import para no fallar si no está instalado
    const puppeteer = await import('puppeteer').catch(() => null);
    if (!puppeteer) throw new Error('Puppeteer no disponible');

    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
    });
    await browser.close();

    return { tipo: 'pdf', buffer: Buffer.from(pdfBuffer), contentType: 'application/pdf' };
  } catch {
    // Fallback: devolver HTML (el browser puede imprimir a PDF)
    return { tipo: 'html', html, contentType: 'text/html' };
  }
}
```

────────────────────────────────────────────────────────────
PASO 3 — RUTAS API
────────────────────────────────────────────────────────────

Crea apps/api/src/routes/pdf.ts.

Adapta imports (requireAuth, resolverAlcance, db, AlmacenArchivos) al patrón
del proyecto. Lee planes.ts para confirmar la firma exacta.

```typescript
import { FastifyInstance } from 'fastify';
import { recopilarDatosPDF } from '../pdf/datos';
import { generarPDF } from '../pdf/generar';

export async function pdfRoutes(app: FastifyInstance) {

  // ── POST /api/pacientes/:pacienteId/pdf ─────────────────────────────────
  // Genera el PDF y lo devuelve como descarga directa.
  // También guarda el registro en pdf_export.
  app.post('/api/pacientes/:pacienteId/pdf',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { pacienteId } = request.params as { pacienteId: string };
      const clinicaId = request.auth.tenantId;
      const body = request.body as {
        secciones: string[];         // ej: ["perfil","plan","laboratorios"]
        notas_profesional?: string;  // estrategia / recomendaciones
      };

      // Verificar acceso al paciente
      const acceso = await resolverAlcance(request, pacienteId);
      if (!acceso) return reply.code(404).send({ error: 'Paciente no encontrado' });

      // Resolver profesional_id — mismo patrón que en planes.ts
      const prof = await db.query(
        `SELECT id, nombre FROM profesional WHERE keycloak_user_id = $1 AND clinica_id = $2`,
        [request.auth.sub, clinicaId]
      );
      if (!prof.rows.length) return reply.code(403).send({ error: 'Profesional no encontrado' });
      const profesionalId = prof.rows[0].id;

      // Validar secciones
      const SECCIONES_VALIDAS = ['perfil', 'plan', 'laboratorios', 'sociodemografico'];
      const secciones = (body.secciones ?? []).filter(s => SECCIONES_VALIDAS.includes(s));
      if (!secciones.length) secciones.push('perfil', 'plan');

      // Recopilar datos
      const datos = await recopilarDatosPDF(
        pacienteId, clinicaId, profesionalId,
        secciones, body.notas_profesional ?? ''
      );

      // Generar PDF (o HTML fallback)
      const resultado = await generarPDF(datos, secciones);

      // Guardar registro en pdf_export
      const nombreArchivo = `Reporte_${datos.paciente.nombre.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.${resultado.tipo === 'pdf' ? 'pdf' : 'html'}`;
      const tamano = resultado.tipo === 'pdf' ? resultado.buffer.length : Buffer.byteLength(resultado.html, 'utf8');

      await db.query(
        `INSERT INTO pdf_export
           (clinica_id, paciente_id, profesional_id, secciones,
            archivo_nombre, archivo_tamano, notas_profesional)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [clinicaId, pacienteId, profesionalId, JSON.stringify(secciones),
         nombreArchivo, tamano, body.notas_profesional ?? null]
      );

      // Responder con el archivo
      reply.header('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
      reply.header('Content-Type', resultado.contentType);
      if (resultado.tipo === 'pdf') {
        return reply.send(resultado.buffer);
      } else {
        return reply.send(resultado.html);
      }
    }
  );

  // ── GET /api/pacientes/:pacienteId/pdf/historial ────────────────────────
  // Historial de exportaciones del paciente
  app.get('/api/pacientes/:pacienteId/pdf/historial',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { pacienteId } = request.params as { pacienteId: string };
      const clinicaId = request.auth.tenantId;

      const acceso = await resolverAlcance(request, pacienteId);
      if (!acceso) return reply.code(404).send({ error: 'Paciente no encontrado' });

      const res = await db.query(
        `SELECT pe.id, pe.secciones, pe.archivo_nombre, pe.archivo_tamano,
                pe.enviado_paciente, pe.enviado_en, pe.created_at,
                pr.nombre AS profesional_nombre
         FROM pdf_export pe
         JOIN profesional pr ON pr.id = pe.profesional_id
         WHERE pe.clinica_id = $1 AND pe.paciente_id = $2
         ORDER BY pe.created_at DESC
         LIMIT 20`,
        [clinicaId, pacienteId]
      );
      return reply.send(res.rows);
    }
  );
}
```

────────────────────────────────────────────────────────────
PASO 4 — REGISTRAR RUTA
────────────────────────────────────────────────────────────

Lee apps/api/src/server.ts y registra pdfRoutes siguiendo el mismo patrón
que las otras rutas. Importa desde '../routes/pdf'.

────────────────────────────────────────────────────────────
PASO 5 — ExportarPDFModal.tsx
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/ExportarPDFModal.tsx

```tsx
import { useState } from 'react';
// Importa useAuth o el hook de token que usa el proyecto

interface Seccion {
  key: string;
  label: string;
  descripcion: string;
  disponible: boolean;
  advertencia?: string;
}

interface ExportarPDFModalProps {
  pacienteId: string;
  pacienteNombre: string;
  tienePlanActivo: boolean;
  tieneConsentimientoSocio: boolean;
  onCerrar: () => void;
}

export default function ExportarPDFModal({
  pacienteId,
  pacienteNombre,
  tienePlanActivo,
  tieneConsentimientoSocio,
  onCerrar,
}: ExportarPDFModalProps) {
  const { getToken } = useAuth(); // adapta al hook real del proyecto

  const SECCIONES: Seccion[] = [
    {
      key: 'perfil',
      label: 'Perfil del paciente',
      descripcion: 'Datos generales, contacto y alergias',
      disponible: true,
    },
    {
      key: 'plan',
      label: 'Plan de alimentación activo',
      descripcion: 'Grilla semanal de comidas con kcal',
      disponible: tienePlanActivo,
      advertencia: !tienePlanActivo ? 'No hay plan activo para este paciente' : undefined,
    },
    {
      key: 'laboratorios',
      label: 'Resultados de laboratorio',
      descripcion: 'Exámenes subidos al expediente',
      disponible: true,
    },
    {
      key: 'sociodemografico',
      label: 'Contexto sociodemográfico',
      descripcion: 'Datos de hábitos y contexto social',
      disponible: tieneConsentimientoSocio,
      advertencia: !tieneConsentimientoSocio
        ? 'Requiere consentimiento del paciente'
        : undefined,
    },
  ];

  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(
    new Set(['perfil', ...(tienePlanActivo ? ['plan'] : [])])
  );
  const [notas, setNotas] = useState('');
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState('');

  const toggle = (key: string) => {
    setSeleccionadas(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const exportar = async () => {
    if (!seleccionadas.size) {
      setError('Selecciona al menos una sección');
      return;
    }
    setGenerando(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`/api/pacientes/${pacienteId}/pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          secciones: Array.from(seleccionadas),
          notas_profesional: notas.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error('Error al generar el PDF');

      // Descargar el archivo
      const blob = await res.blob();
      const contentDisp = res.headers.get('Content-Disposition') ?? '';
      const nombreMatch = contentDisp.match(/filename="([^"]+)"/);
      const nombre = nombreMatch?.[1] ?? `Reporte_${pacienteNombre}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      a.click();
      URL.revokeObjectURL(url);
      onCerrar();
    } catch (e: any) {
      setError(e.message ?? 'Error inesperado');
    } finally {
      setGenerando(false);
    }
  };

  const seccionesSeleccionadas = seleccionadas.size;

  return (
    // Overlay
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Exportar expediente como PDF</h2>
            <p className="text-sm text-gray-500 mt-0.5">{pacienteNombre}</p>
          </div>
          <button
            onClick={onCerrar}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Secciones */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-700">Secciones a incluir</p>
              <span className="text-xs font-medium text-primary">
                {seccionesSeleccionadas} seleccionada{seccionesSeleccionadas !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="space-y-2">
              {SECCIONES.map(s => (
                <label
                  key={s.key}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    !s.disponible
                      ? 'opacity-50 cursor-not-allowed border-gray-100 bg-gray-50'
                      : seleccionadas.has(s.key)
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={seleccionadas.has(s.key)}
                    disabled={!s.disponible}
                    onChange={() => s.disponible && toggle(s.key)}
                    className="mt-0.5 accent-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{s.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.descripcion}</p>
                    {s.advertencia && (
                      <p className="text-xs text-amber-600 mt-1">⚠ {s.advertencia}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Estrategia / recomendaciones */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Estrategia y recomendaciones
              <span className="text-gray-400 font-normal ml-1">(opcional)</span>
            </label>
            <textarea
              rows={5}
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Escribe aquí las recomendaciones, estrategia nutricional o notas que quieres que aparezcan en el documento…"
              className="w-full text-sm border border-gray-200 rounded-xl p-3 resize-none focus:outline-none focus:border-primary"
              maxLength={3000}
            />
            <p className="text-xs text-gray-400 text-right mt-1">{notas.length}/3000</p>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onCerrar}
            disabled={generando}
            className="px-4 py-2 text-sm border border-gray-200 text-gray-600 rounded-xl hover:border-gray-300 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={exportar}
            disabled={generando || !seleccionadas.size}
            className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-xl hover:bg-primary-hover disabled:opacity-50 flex items-center gap-2"
          >
            {generando ? (
              <>
                <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Generando…
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                  strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Descargar PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
```

────────────────────────────────────────────────────────────
PASO 6 — Integrar en PacienteFicha.tsx
────────────────────────────────────────────────────────────

Lee apps/web-professional/src/pages/PacienteFicha.tsx.

1. Agrega el import de ExportarPDFModal.
2. Agrega estado: `const [mostrarPDF, setMostrarPDF] = useState(false)`.
3. En el encabezado del expediente (donde están los botones de acción del
   paciente: Mensaje, Agendar, etc.), agrega el botón de exportar PDF:

```tsx
<button
  onClick={() => setMostrarPDF(true)}
  className="flex items-center gap-1.5 px-3 py-2 border border-primary text-primary rounded-xl text-sm font-medium hover:bg-primary/5 transition-colors"
>
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
    strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
  Exportar PDF
</button>
```

4. Antes del cierre del JSX principal, agrega el modal condicionalmente:

```tsx
{mostrarPDF && (
  <ExportarPDFModal
    pacienteId={paciente.id}
    pacienteNombre={paciente.nombre}
    tienePlanActivo={/* determina si el paciente tiene plan activo —
                       puedes pasar un flag desde el estado de la ficha,
                       o dejar siempre true y que el PDF lo maneje silenciosamente */}
    tieneConsentimientoSocio={/* igual: flag del estado de sociodemografía */}
    onCerrar={() => setMostrarPDF(false)}
  />
)}
```

NOTA: Si no tienes los flags disponibles de forma inmediata en el contexto
de PacienteFicha, simplifica pasando `tienePlanActivo={true}` y
`tieneConsentimientoSocio={true}` por ahora — el API devuelve el PDF
con las secciones disponibles y simplemente omite las que no tienen datos.

────────────────────────────────────────────────────────────
PASO 7 — VERIFICACIÓN
────────────────────────────────────────────────────────────

1. npm run migrate en apps/api → tabla pdf_export creada sin error.

2. Compilar sin errores TypeScript:
   cd apps/web-professional && npm run build

3. Con el frontend levantado (http://localhost:5173):

   a) Abrir la ficha de un paciente que tenga plan activo.
      El encabezado debe mostrar el botón "Exportar PDF".

   b) Hacer clic → se abre el modal con las secciones disponibles.
      Sección "Plan de alimentación activo" debe estar habilitada.

   c) Seleccionar Plan + Laboratorios, escribir unas recomendaciones,
      hacer clic en "Descargar PDF".
      El navegador debe descargar un archivo .pdf (o .html si Puppeteer
      no está disponible) con el contenido correcto.

   d) Verificar que el PDF incluye:
      - Encabezado con el nombre de la clínica (y logo si existe brand_config).
      - Color del encabezado según color_primario de brand_config.
      - Grilla del plan de alimentación completa.
      - Sección de recomendaciones con el texto escrito.

   e) Prueba de aislamiento: con token de otra clínica,
      POST /api/pacientes/:id/pdf → debe responder 404.

4. Prueba de Puppeteer / fallback:
   Si Puppeteer está disponible → archivo descargado es application/pdf.
   Si no está disponible → archivo descargado es text/html (abrir en
   navegador y usar Ctrl+P → Guardar como PDF para verificar el layout).

────────────────────────────────────────────────────────────
PASO 8 — PRUEBAS.md Y COMMIT
────────────────────────────────────────────────────────────

Agrega al final de docs/PRUEBAS.md la sección "Rebanada 10 — Export PDF"
con los casos en formato PowerShell, siguiendo el estilo de las secciones
anteriores. Incluye al menos:

```
## Rebanada 10 — Export PDF del Expediente (CLI-05)

# CA-10-01: Generar PDF con plan y recomendaciones
$body = '{"secciones":["perfil","plan"],"notas_profesional":"Reducir sodio y aumentar proteína."}'
Invoke-WebRequest -Uri "http://localhost:4001/api/pacientes/$pacienteId/pdf" `
  -Method POST -Headers @{Authorization="Bearer $token"} `
  -ContentType "application/json" -Body $body `
  -OutFile "reporte_test.pdf"
# Verificar que el archivo se descargó y pesa más de 0 bytes

# CA-10-02: Sección sociodemográfica sin consentimiento → no aparece en PDF
# Incluir "sociodemografico" en secciones para paciente sin consentimiento activo
# → La sección no aparece en el documento (se omite silenciosamente)

# CA-10-03: Aislamiento de tenant
Invoke-RestMethod -Uri "http://localhost:4001/api/pacientes/$pacienteIdOtraClinica/pdf" `
  -Method POST -Headers @{Authorization="Bearer $tokenClinicaA"} `
  -ContentType "application/json" -Body $body
# → 404

# CA-10-04: Historial de exportaciones
Invoke-RestMethod -Uri "http://localhost:4001/api/pacientes/$pacienteId/pdf/historial" `
  -Method GET -Headers @{Authorization="Bearer $token"}
# → array con la exportación recién creada

# CA-10-05: PDF incluye colores de la clínica (white-label)
# Verificar visualmente que el encabezado del PDF usa el color de brand_config
```

Commit con este mensaje exacto:

R10: export PDF del expediente clínico (CLI-05)

- Migración 012: tabla pdf_export con historial de exportaciones
- apps/api/src/pdf/: recopilación de datos, template HTML y generador
- Generación con Puppeteer (fallback a HTML si no disponible)
- White-label: portada usa logo y color_primario de brand_config
- POST /api/pacientes/:id/pdf — genera y descarga el PDF
- GET /api/pacientes/:id/pdf/historial — historial de exportaciones
- ExportarPDFModal.tsx con selección de secciones y campo de estrategia
- Botón "Exportar PDF" integrado en el encabezado de PacienteFicha
- Sección R10 en docs/PRUEBAS.md

git push origin main y reporta el hash del commit.
