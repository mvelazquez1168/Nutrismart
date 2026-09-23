Lee docs/REBANADA-09.md para entender el contexto del proyecto. Esta es la
Rebanada 12: interpretación inteligente de laboratorios y generación de notas SOAP
con IA (IA-01, IA-02).

────────────────────────────────────────────────────────────
ANTES DE ESCRIBIR CUALQUIER CÓDIGO — leer estas referencias
────────────────────────────────────────────────────────────

1. Lee apps/api/src/routes/planes.ts — úsalo como plantilla de ruta: patrón
   requireAuth, resolución de profesional_id por keycloak_user_id, clinica_id
   desde request.auth.tenantId, uso de resolverAlcance.
2. Lee apps/api/src/server.ts — confirma cómo se registran rutas y plugins.
3. Lee apps/api/migrations/ — confirma que la última migración es 014.
   La tuya será 015_ia.sql.
4. Lee apps/api/src/routes/ — busca la ruta de laboratorios (labs.ts o similar)
   para entender la estructura de lab_exam y lab_resultado. La interpretación IA
   se agrega como extensión de ese módulo.
5. Lee apps/web-professional/src/pages/PacienteFicha.tsx — identifica la pestaña
   o sección de laboratorios donde integrar PanelInterpretacionIA. Identifica
   también dónde agregar el generador SOAP.
6. Verifica que ANTHROPIC_API_KEY exista en apps/api/.env:
     grep ANTHROPIC_API_KEY apps/api/.env
   Si no existe, agrégala: ANTHROPIC_API_KEY=<tu clave>
   NUNCA la pongas en código fuente ni en archivos versionados.
7. Verifica que @anthropic-ai/sdk esté instalado:
     cat apps/api/package.json | grep anthropic
   Si NO está: npm install @anthropic-ai/sdk --prefix apps/api
8. Revisa disenos/ai/ — archivos de diseño de referencia para PanelInterpretacionIA
   y GeneradorSOAP antes de implementar los componentes.

────────────────────────────────────────────────────────────
PASO 1 — MIGRACIÓN 015: TABLAS IA
────────────────────────────────────────────────────────────

Archivo: apps/api/migrations/015_ia.sql

```sql
-- migration: 015_ia

CREATE TABLE interpretacion_ia (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      UUID        NOT NULL REFERENCES clinica(id),
  lab_exam_id     UUID        NOT NULL REFERENCES lab_exam(id),
  paciente_id     UUID        NOT NULL REFERENCES paciente(id),
  profesional_id  UUID        NOT NULL REFERENCES profesional(id),
  modelo          TEXT        NOT NULL,
  -- ej: 'claude-3-5-haiku-20241022'
  prompt_usado    TEXT        NOT NULL,
  interpretacion  TEXT        NOT NULL,
  tokens_entrada  INT,
  tokens_salida   INT,
  revisada        BOOLEAN     NOT NULL DEFAULT false,
  revisada_en     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_interp_exam
  ON interpretacion_ia (lab_exam_id, created_at DESC);

CREATE INDEX idx_interp_paciente
  ON interpretacion_ia (clinica_id, paciente_id, created_at DESC);

CREATE TABLE nota_soap (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      UUID        NOT NULL REFERENCES clinica(id),
  paciente_id     UUID        NOT NULL REFERENCES paciente(id),
  profesional_id  UUID        NOT NULL REFERENCES profesional(id),
  subjetivo       TEXT,
  objetivo        TEXT,
  analisis        TEXT,
  plan_soap       TEXT,
  -- 'plan_soap' evita colisión con palabra reservada 'plan'
  generada_ia     BOOLEAN     NOT NULL DEFAULT false,
  revisada        BOOLEAN     NOT NULL DEFAULT false,
  revisada_en     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_soap_paciente
  ON nota_soap (clinica_id, paciente_id, created_at DESC);
```

Ejecuta npm run migrate y confirma las tablas.

────────────────────────────────────────────────────────────
PASO 2 — MÓDULO IA: CLIENTE Y PROMPTS
────────────────────────────────────────────────────────────

Crea apps/api/src/ia/cliente.ts

```typescript
// apps/api/src/ia/cliente.ts
import Anthropic from '@anthropic-ai/sdk';

// Instancia singleton reutilizable
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const MODELO_IA = 'claude-3-5-haiku-20241022';
// Haiku es suficientemente capaz y mucho más económico para interpretaciones clínicas v1.
// Cambiar a claude-3-5-sonnet-20241022 si la calidad no es satisfactoria.

export interface ResultadoIA {
  texto: string;
  tokensEntrada: number;
  tokensSalida: number;
  modelo: string;
  promptUsado: string;
}

export async function llamarClaude(prompt: string): Promise<ResultadoIA> {
  const response = await anthropic.messages.create({
    model: MODELO_IA,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const texto = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  return {
    texto,
    tokensEntrada: response.usage.input_tokens,
    tokensSalida: response.usage.output_tokens,
    modelo: response.model,
    promptUsado: prompt,
  };
}
```

Crea apps/api/src/ia/prompts.ts

```typescript
// apps/api/src/ia/prompts.ts

export interface DatosInterpretacionLabs {
  pacienteNombre: string;
  pacienteEdad: number;
  pacienteSexo: string;
  marcadores: Array<{
    nombre: string;
    valor: number | string;
    unidad: string;
    rangoMin?: number;
    rangoMax?: number;
    estado: 'normal' | 'bajo' | 'alto' | 'critico';
  }>;
}

export function promptInterpretacionLabs(datos: DatosInterpretacionLabs): string {
  const marcadoresTexto = datos.marcadores
    .map(
      (m) =>
        `- ${m.nombre}: ${m.valor} ${m.unidad}` +
        (m.rangoMin !== undefined ? ` (ref: ${m.rangoMin}–${m.rangoMax})` : '') +
        (m.estado !== 'normal' ? ` [${m.estado.toUpperCase()}]` : '')
    )
    .join('\n');

  return `Eres un nutricionista clínico experto. Analiza los siguientes resultados de laboratorio del paciente ${datos.pacienteNombre} (${datos.pacienteEdad} años, ${datos.pacienteSexo}) y proporciona una interpretación nutricional estructurada.

MARCADORES DE LABORATORIO:
${marcadoresTexto}

Proporciona una interpretación estructurada con estas secciones:
1. RESUMEN CLÍNICO — hallazgos principales en 2-3 oraciones
2. IMPLICACIONES NUTRICIONALES — deficiencias, excesos o riesgos identificados con su relevancia dietética
3. RECOMENDACIONES DIETÉTICAS — acciones específicas basadas en los resultados (alimentos, nutrientes, patrones)
4. SEGUIMIENTO PRIORITARIO — marcadores que requieren atención o re-evaluación urgente

Usa terminología técnica apropiada para un profesional de la salud. Sé preciso y basado en evidencia. Máximo 600 palabras. No uses disclaimers genéricos.`;
}

export interface DatosSOAP {
  pacienteNombre: string;
  pacienteEdad: number;
  pacienteSexo: string;
  motivoConsulta?: string;
  pesoActual?: number;
  tallaActual?: number;
  imc?: number;
  composicionCorporal?: string;  // texto libre con LBM, %grasa, etc.
  laboratoriosRelevantes?: string;  // resumen de labs anormales
  historialClinico?: string;        // resumen de APF/APP/farmacología
  consumoDietetico?: string;        // resumen del recordatorio 24h
  planPrescrito?: string;           // descripción del plan alimentario
  observacionesProfesional?: string;
}

export function promptGenerarSOAP(datos: DatosSOAP): string {
  const contexto = [
    datos.motivoConsulta ? `Motivo de consulta: ${datos.motivoConsulta}` : null,
    datos.pesoActual ? `Peso: ${datos.pesoActual} kg, Talla: ${datos.tallaActual} cm, IMC: ${datos.imc}` : null,
    datos.composicionCorporal ? `Composición corporal: ${datos.composicionCorporal}` : null,
    datos.laboratoriosRelevantes ? `Laboratorios relevantes: ${datos.laboratoriosRelevantes}` : null,
    datos.historialClinico ? `Historial clínico: ${datos.historialClinico}` : null,
    datos.consumoDietetico ? `Consumo dietético: ${datos.consumoDietetico}` : null,
    datos.planPrescrito ? `Plan prescrito: ${datos.planPrescrito}` : null,
    datos.observacionesProfesional ? `Observaciones del profesional: ${datos.observacionesProfesional}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `Eres un asistente clínico para nutricionistas. Genera una nota SOAP estructurada basada en la siguiente información del paciente ${datos.pacienteNombre} (${datos.pacienteEdad} años, ${datos.pacienteSexo}).

DATOS DE LA CONSULTA:
${contexto}

Genera la nota SOAP con exactamente estas 4 secciones en español:

S (SUBJETIVO):
[Lo que refiere el paciente: síntomas, quejas, cambios percibidos, adherencia al plan anterior, estado emocional relacionado con la alimentación]

O (OBJETIVO):
[Datos medibles y observables: peso, talla, IMC, composición corporal, signos clínicos, resultados de laboratorio relevantes]

A (ANÁLISIS):
[Diagnóstico nutricional e interpretación clínica: estado nutricional actual, avances, problemas identificados, barreras]

P (PLAN):
[Intervenciones: prescripción dietética, metas a corto plazo, suplementos si aplica, seguimiento, acuerdos con el paciente]

Usa terminología clínica nutricional apropiada. Sé conciso pero completo. Máximo 500 palabras en total.`;
}
```

────────────────────────────────────────────────────────────
PASO 3 — API ROUTES: INTERPRETACIÓN DE LABORATORIOS (IA-01)
────────────────────────────────────────────────────────────

Agrega estos endpoints a la ruta de laboratorios existente, O crea
apps/api/src/routes/ia.ts y regístrala en server.ts.

```
POST /api/labs/:examId/interpretar
     — verifica acceso: lab_exam.clinica_id = JWT tenantId (devuelve 404 si no pertenece)
     — resuelve profesional_id desde sub via keycloak_user_id
     — SELECT lab_exam + todos los lab_resultado del examId
     — SELECT paciente (nombre, fecha_nacimiento, sexo) para calcular edad
     — construye DatosInterpretacionLabs desde los resultados
     — llama a promptInterpretacionLabs() y luego a llamarClaude()
     — INSERT en interpretacion_ia con el resultado
     — devuelve { id, interpretacion, modelo, tokens_salida, created_at }

     En caso de error de la API de Anthropic (red, rate limit, etc.):
     — captura el error, devuelve 503 con { error: 'IA service temporarily unavailable' }
     — NO dejes que el error suba sin manejar

GET  /api/labs/:examId/interpretacion
     — devuelve la interpretacion_ia más reciente del examId
     — SELECT ... WHERE lab_exam_id = $1 ORDER BY created_at DESC LIMIT 1
     — devuelve 404 { error: 'No interpretation yet' } si no hay ninguna

PUT  /api/labs/:examId/interpretacion/:intId/revisar
     — UPDATE revisada=true, revisada_en=now()
     — verifica que interpretacion.clinica_id = JWT tenantId
     — devuelve { revisada: true }
```

────────────────────────────────────────────────────────────
PASO 4 — API ROUTES: NOTAS SOAP (IA-02)
────────────────────────────────────────────────────────────

Agrega a la ruta IA o crea sección en apps/api/src/routes/ia.ts:

```
POST /api/pacientes/:pacienteId/soap/generar
     — verifica acceso del paciente (resolverAlcance → 404 si es de otra clínica)
     — resuelve profesional_id desde sub
     — body (todos opcionales): { motivoConsulta?, observacionesProfesional? }
     — SELECT datos del paciente (nombre, fecha_nacimiento, sexo)
     — SELECT última medición antropométrica si existe
     — SELECT labs anormales de los últimos 90 días si existen
     — SELECT plan_alimentario activo (nombre y tipo si existe)
     — construye DatosSOAP, llama promptGenerarSOAP() y llamarClaude()
     — NO persiste en DB (el borrador lo guarda el profesional si lo aprueba)
     — devuelve { borrador: { subjetivo, objetivo, analisis, plan_soap }, tokens_salida }

     Parseo del borrador:
     — la respuesta de Claude viene como texto corrido con secciones S/O/A/P
     — parsear buscando las marcas "S (SUBJETIVO):", "O (OBJETIVO):", "A (ANÁLISIS):", "P (PLAN):"
     — extraer el texto de cada sección en un objeto { subjetivo, objetivo, analisis, plan_soap }

POST /api/pacientes/:pacienteId/soap
     body: { subjetivo, objetivo, analisis, plan_soap, generada_ia: boolean }
     — INSERT nota_soap (profesional edita el borrador y lo guarda)
     — devuelve la nota_soap creada

GET  /api/pacientes/:pacienteId/soap
     — lista las nota_soap del paciente, ORDER BY created_at DESC, LIMIT 20
     — devuelve array con id, subjetivo (primeros 120 chars), profesional_nombre, generada_ia, revisada, created_at

GET  /api/pacientes/:pacienteId/soap/:soapId
     — devuelve nota_soap completa

PUT  /api/pacientes/:pacienteId/soap/:soapId
     body: { subjetivo?, objetivo?, analisis?, plan_soap? }
     — actualiza campos provistos + updated_at = now()
     — verifica clinica_id y profesional_id (solo el autor puede editar)
     — devuelve nota actualizada

PUT  /api/pacientes/:pacienteId/soap/:soapId/revisar
     — UPDATE revisada=true, revisada_en=now()
     — devuelve { revisada: true }
```

────────────────────────────────────────────────────────────
PASO 5 — FRONTEND: PANEL INTERPRETACIÓN IA (IA-01)
────────────────────────────────────────────────────────────

Revisa el diseño en disenos/ai/ antes de implementar.

Crea apps/web-professional/src/components/ia/PanelInterpretacionIA.tsx

```tsx
// Props: examId: string, pacienteId: string
//
// Comportamiento:
// 1. Al montar: GET /api/labs/:examId/interpretacion
//    - Si existe → muestra la interpretación ya guardada (con badge "Reviewed" si revisada)
//    - Si 404    → muestra estado inicial "No interpretation yet"
//
// Layout del panel (card lateral dentro de la vista de labs):
// ┌────────────────────────────────────────────────────┐
// │ 🤖 AI Interpretation       [Interpret] [Reviewed✓] │
// │ ─────────────────────────────────────────────────  │
// │ Texto de la interpretación (4 secciones parseadas) │
// │ RESUMEN CLÍNICO                                     │
// │ párrafo...                                          │
// │ IMPLICACIONES NUTRICIONALES                         │
// │ párrafo...                                          │
// │ (etc.)                                             │
// │ ─────────────────────────────────────────────────  │
// │ Generado por claude-3-5-haiku · Aug 14 · 320 tokens│
// │ [Mark as reviewed]                                  │
// └────────────────────────────────────────────────────┘
//
// Botón "Interpret" (o "Re-interpret" si ya existe):
// - Estado loading: spinner + "Analyzing..."
// - POST /api/labs/:examId/interpretar
// - Al resolver: actualiza el texto mostrado
// - Al error 503: toast "AI service temporarily unavailable. Try again."
//
// Renderizado del texto:
// - El texto viene como string plano; dividir por saltos de línea
//   y mostrar con tipografía legible (font-size 14px, line-height 1.6)
// - Las cabeceras de sección (RESUMEN CLÍNICO, etc.) en bold teal-700
//
// Badge "AI-generated" (pequeño chip naranja) junto al título
// Badge "Reviewed" (chip verde) cuando revisada=true
// Disclaimer: "This interpretation is an AI-generated clinical aid.
//   Always apply professional judgment." (texto muted pequeño al pie)
```

Integra PanelInterpretacionIA en la vista de detalle de laboratorio existente
(LabDetalle.tsx o el componente donde se muestran los resultados individuales).
Colócalo como panel lateral derecho o sección al pie de la tabla de resultados.

────────────────────────────────────────────────────────────
PASO 6 — FRONTEND: GENERADOR SOAP Y TARJETA SOAP (IA-02)
────────────────────────────────────────────────────────────

Revisa el diseño en disenos/ai/ antes de implementar.

Crea apps/web-professional/src/components/ia/GeneradorSOAP.tsx
Crea apps/web-professional/src/components/ia/TarjetaSOAP.tsx
Crea apps/web-professional/src/components/ia/ListaSOAP.tsx

**GeneradorSOAP.tsx**:

```tsx
// Props: pacienteId: string, onGuardado: (nota: NotaSOAP) => void
//
// Estado: 'idle' | 'generando' | 'revisando' | 'guardado'
//
// Fase 'idle':
//   - Input opcional: "Chief complaint / reason for visit" (textarea, 200 chars)
//   - Input opcional: "Additional observations" (textarea, 500 chars)
//   - Botón "Generate SOAP with AI" (teal, sparkle icon)
//   - Link "Write manually instead" → activa modo manual (los 4 textareas sin IA)
//
// Fase 'generando':
//   - POST /api/pacientes/:id/soap/generar con los campos opcionales
//   - Spinner + "Generating SOAP note..."
//   - El botón está desactivado
//
// Fase 'revisando' (borrador recibido):
//   Cuatro textareas editables, una por sección:
//
//   S · Subjective (textarea 4 rows, label "Patient's perspective & complaints")
//   O · Objective  (textarea 4 rows, label "Measurable data & observations")
//   A · Analysis   (textarea 4 rows, label "Nutritional diagnosis & interpretation")
//   P · Plan       (textarea 4 rows, label "Interventions, prescriptions & follow-up")
//
//   - Pre-rellenados con el borrador de la IA
//   - El profesional puede editar libremente
//   - Banner amber en la parte superior:
//     "⚠ Review and edit this AI-generated draft before saving.
//      You take clinical responsibility for the final note."
//   - Botón "Save SOAP note" → POST /api/pacientes/:id/soap
//     { subjetivo, objetivo, analisis, plan_soap, generada_ia: true }
//   - Botón "Discard" → vuelve a 'idle'
//
// Fase 'guardado':
//   - Mensaje de confirmación + badge "Saved"
//   - Llama onGuardado(nota) para actualizar ListaSOAP
```

**TarjetaSOAP.tsx**:

```tsx
// Props: nota: NotaSOAP (completa), onEditar?, onRevisar?
//
// Card compacta para el timeline del expediente:
// ┌────────────────────────────────────────────────────┐
// │ SOAP Note  [AI] [Reviewed]  14 Aug 2026  Dr. García│
// │ ─────────────────────────────────────────────────  │
// │ S: Los primeros 100 chars del subjetivo...  ▼      │
// └────────────────────────────────────────────────────┘
//
// Al expandir (click en ▼):
//   Muestra las 4 secciones completas con labels S/O/A/P
//   Botones al pie: "Edit" (si no revisada) | "Mark as reviewed"
//
// Badge [AI] (chip naranja pequeño) si generada_ia=true
// Badge [Reviewed] (chip verde) si revisada=true
```

**ListaSOAP.tsx**:

```tsx
// Props: pacienteId: string
// - GET /api/pacientes/:id/soap al montar
// - Lista de TarjetaSOAP (orden cronológico inverso)
// - Botón "+ New SOAP note" que abre GeneradorSOAP en un modal o sección expandible
// - Empty state: "No SOAP notes yet. Generate the first one."
```

Integra ListaSOAP en PacienteFicha.tsx:
- Agrega una nueva pestaña "SOAP Notes" (junto a Plan, Labs, etc.)
- El contenido de la pestaña es <ListaSOAP pacienteId={pacienteId} />

────────────────────────────────────────────────────────────
PASO 7 — MANEJO DE ERRORES Y LÍMITES DE USO
────────────────────────────────────────────────────────────

En apps/api/src/ia/cliente.ts, el handler de errores ya captura errores de Anthropic
y devuelve 503. Agrega también:

1. Timeout: si la llamada tarda más de 30 segundos, abortar y devolver 503.
   Usa `AbortSignal.timeout(30000)` en la llamada.

2. Log de uso: cada llamada exitosa registra en consola:
   `console.log('[IA] modelo=%s entrada=%d salida=%d endpoint=%s', modelo, tokens_in, tokens_out, endpoint)`
   Esto permite monitorear el consumo de tokens sin infraestructura adicional en v1.

3. No limites por clínica todavía (eso es la épica SUB de suscripción). En v1 cualquier
   profesional autenticado puede llamar a la IA.

────────────────────────────────────────────────────────────
PASO 8 — PRUEBAS.md — SECCIÓN R12
────────────────────────────────────────────────────────────

Agrega al final de docs/PRUEBAS.md:

```markdown
## R12 — IA clínica: interpretación de labs y notas SOAP (IA-01, IA-02)

### Requisito previo
- ANTHROPIC_API_KEY configurada en apps/api/.env
- @anthropic-ai/sdk instalado en apps/api

### IA-01 · Interpretación de laboratorios

- [ ] CA-12-01 POST /api/labs/:examId/interpretar devuelve texto de interpretación
               con las 4 secciones (RESUMEN, IMPLICACIONES, RECOMENDACIONES, SEGUIMIENTO).
- [ ] CA-12-02 El resultado se persiste en interpretacion_ia y GET /interpretacion lo devuelve.
- [ ] CA-12-03 La interpretación incluye el modelo usado y los contadores de tokens.
- [ ] CA-12-04 Si el examId no pertenece a la clínica del JWT → 404 (no 403).
- [ ] CA-12-05 Si ANTHROPIC_API_KEY no está configurada o Anthropic devuelve error → 503.
- [ ] CA-12-06 PUT /api/labs/:examId/interpretacion/:intId/revisar pone revisada=true.
- [ ] CA-12-07 PanelInterpretacionIA muestra el botón "Interpret", genera y muestra el texto.
- [ ] CA-12-08 Badge "AI-generated" visible; disclaimer aparece al pie del panel.

### IA-02 · Notas SOAP

- [ ] CA-12-09 POST /api/pacientes/:id/soap/generar devuelve borrador con 4 campos
               (subjetivo, objetivo, analisis, plan_soap) no vacíos.
- [ ] CA-12-10 El borrador NO se guarda en DB hasta que el profesional confirme.
- [ ] CA-12-11 POST /api/pacientes/:id/soap guarda la nota con generada_ia=true.
- [ ] CA-12-12 GET /api/pacientes/:id/soap devuelve la nota en la lista.
- [ ] CA-12-13 PUT /api/pacientes/:id/soap/:soapId actualiza los campos editados.
- [ ] CA-12-14 PUT .../revisar pone revisada=true y revisada_en.
- [ ] CA-12-15 GeneradorSOAP muestra el banner de advertencia clínica antes de guardar.
- [ ] CA-12-16 TarjetaSOAP en el expediente muestra badge [AI] y las 4 secciones al expandir.
- [ ] CA-12-17 Un profesional de otra clínica que intente generar SOAP para este paciente → 404.
- [ ] CA-12-18 Llamadas a IA quedan registradas en consola (modelo, tokens entrada/salida).
```

────────────────────────────────────────────────────────────
PASO 9 — COMMIT
────────────────────────────────────────────────────────────

Ejecuta linters y build antes de commitear:
  npm run lint --prefix apps/api
  npm run lint --prefix apps/web-professional
  npm run build --prefix apps/api

Si el build pasa:

  git add apps/api/migrations/015_ia.sql
  git add apps/api/src/ia/
  git add apps/api/src/routes/ia.ts   # o donde hayas colocado las rutas
  git add apps/web-professional/src/components/ia/
  git add docs/PRUEBAS.md
  # Si modificaste rutas de labs o PacienteFicha:
  git add apps/api/src/routes/labs.ts
  git add apps/web-professional/src/pages/PacienteFicha.tsx

  git commit -m "R12: interpretación IA de laboratorios y generador de notas SOAP (IA-01, IA-02)"

Reporta el hash del commit al finalizar.
