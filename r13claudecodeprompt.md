Lee docs/REBANADA-09.md para entender el contexto del proyecto. Esta es la
Rebanada 13: contenedor de valoración nutricional + Antropometría + Bioquímica integrada
(EVAL-00 container, EVAL-01, EVAL-02).

────────────────────────────────────────────────────────────
ANTES DE ESCRIBIR CUALQUIER CÓDIGO — leer estas referencias
────────────────────────────────────────────────────────────

1. Lee apps/api/src/routes/planes.ts — patrón de auth, resolverAlcance,
   clinica_id desde JWT, resolución profesional_id por keycloak_user_id.
2. Lee apps/api/src/server.ts — cómo se registran rutas.
3. Lee apps/api/migrations/ — confirma que la última migración es 015.
   Las tuyas serán 016_eval_base.sql.
4. Lee apps/api/src/routes/labs.ts (o equivalente) — entiende la estructura
   de lab_exam y lab_resultado. EVAL-02 filtra estos datos sin nueva tabla.
5. Lee apps/web-professional/src/pages/PacienteFicha.tsx — aquí agregarás
   el botón "Nueva consulta" que inicia el flujo de valoración.
6. Revisa disenos/eval/ — diseños de referencia para ValoracionPaciente,
   TabsABCD, FormAntropometria y PanelBioquimica.

────────────────────────────────────────────────────────────
PASO 1 — MIGRACIÓN 016: BASE DE VALORACIÓN
────────────────────────────────────────────────────────────

Archivo: apps/api/migrations/016_eval_base.sql

```sql
-- migration: 016_eval_base

CREATE TYPE estado_consulta AS ENUM ('borrador', 'finalizada');
CREATE TYPE tipo_consulta   AS ENUM ('inicial', 'seguimiento');

CREATE TABLE consulta (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id            UUID            NOT NULL REFERENCES clinica(id),
  paciente_id           UUID            NOT NULL REFERENCES paciente(id),
  profesional_id        UUID            NOT NULL REFERENCES profesional(id),
  tipo                  tipo_consulta   NOT NULL DEFAULT 'inicial',
  numero_consulta       INT             NOT NULL DEFAULT 1,
  estado                estado_consulta NOT NULL DEFAULT 'borrador',
  fecha_consulta        DATE            NOT NULL DEFAULT CURRENT_DATE,
  -- progreso por sección: { antrop: true, bioquim: false, clinico: false, dietetico: false }
  secciones_completas   JSONB           NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_consulta_paciente
  ON consulta (clinica_id, paciente_id, fecha_consulta DESC);

CREATE TYPE metodo_composicion AS ENUM ('bia', 'pliegues');

CREATE TABLE medicion_antropometrica (
  id                  UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id          UUID                    NOT NULL REFERENCES clinica(id),
  paciente_id         UUID                    NOT NULL REFERENCES paciente(id),
  consulta_id         UUID                    REFERENCES consulta(id),
  profesional_id      UUID                    NOT NULL REFERENCES profesional(id),
  fecha_medicion      DATE                    NOT NULL DEFAULT CURRENT_DATE,
  -- Medidas básicas
  peso_kg             NUMERIC(5,2),
  talla_cm            NUMERIC(5,1),
  imc                 NUMERIC(5,2),           -- calculado: peso / (talla/100)^2
  -- Perímetros
  cintura_cm          NUMERIC(5,1),
  cadera_cm           NUMERIC(5,1),
  icc                 NUMERIC(4,3),           -- calculado: cintura / cadera
  brazo_cm            NUMERIC(5,1),
  pierna_cm           NUMERIC(5,1),
  -- Composición corporal
  metodo              metodo_composicion,
  masa_libre_grasa_kg NUMERIC(5,2),
  masa_muscular_kg    NUMERIC(5,2),
  pct_grasa           NUMERIC(5,2),
  masa_grasa_kg       NUMERIC(5,2),
  agua_corporal_pct   NUMERIC(5,2),
  angulo_fase         NUMERIC(4,2),
  -- Pliegues cutáneos (si metodo = 'pliegues')
  pliegues_datos      JSONB,
  -- { tricipital, bicipital, subescapular, suprailíaco, abdominal, muslo, pierna } en mm
  -- fórmula usada, ej: "durnin_womersley"
  pliegues_formula    TEXT,
  created_at          TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX idx_antrop_paciente
  ON medicion_antropometrica (clinica_id, paciente_id, fecha_medicion DESC);
```

Ejecuta npm run migrate y confirma las tablas.

────────────────────────────────────────────────────────────
PASO 2 — API: CONSULTAS (contenedor EVAL-00)
────────────────────────────────────────────────────────────

Crea apps/api/src/routes/consultas.ts y regístrala en server.ts con prefix '/api'.

```
POST /api/pacientes/:pacienteId/consultas
     — resuelve profesional_id desde JWT sub via keycloak_user_id
     — verifica que el paciente pertenezca a la clínica (resolverAlcance → 404 si no)
     — calcula numero_consulta: SELECT COUNT(*)+1 FROM consulta
         WHERE clinica_id=$1 AND paciente_id=$2
     — calcula tipo: si numero_consulta > 1 → 'seguimiento', else 'inicial'
     — INSERT consulta, devuelve el registro

GET  /api/pacientes/:pacienteId/consultas
     — filtra por clinica_id del JWT, ORDER BY fecha_consulta DESC
     — devuelve: id, tipo, numero_consulta, estado, fecha_consulta,
                 secciones_completas, profesional_nombre (JOIN)

GET  /api/pacientes/:pacienteId/consultas/:consultaId
     — devuelve la consulta con todo el JSONB secciones_completas
     — verifica clinica_id

PUT  /api/pacientes/:pacienteId/consultas/:consultaId/seccion
     body: { seccion: 'antrop'|'bioquim'|'clinico'|'dietetico'|'conclusion', completa: boolean }
     — UPDATE secciones_completas con jsonb_set
     — UPDATE updated_at
     — devuelve la consulta actualizada

PUT  /api/pacientes/:pacienteId/consultas/:consultaId/finalizar
     — verifica que la consulta pertenece al profesional resuelto
     — UPDATE estado='finalizada', updated_at=now()
     — devuelve { estado: 'finalizada' }
```

────────────────────────────────────────────────────────────
PASO 3 — API: ANTROPOMETRÍA (EVAL-01)
────────────────────────────────────────────────────────────

Agrega a consultas.ts o crea apps/api/src/routes/antropometria.ts:

```
POST /api/pacientes/:pacienteId/antropometria
     body: {
       consulta_id?: UUID,
       fecha_medicion?: date,
       peso_kg?, talla_cm?,
       cintura_cm?, cadera_cm?, brazo_cm?, pierna_cm?,
       metodo?: 'bia'|'pliegues',
       -- BIA:
       masa_libre_grasa_kg?, masa_muscular_kg?, pct_grasa?,
       masa_grasa_kg?, agua_corporal_pct?, angulo_fase?,
       -- Pliegues:
       pliegues_datos?: object, pliegues_formula?: string
     }
     — calcula IMC si vienen peso_kg y talla_cm: peso / (talla/100)^2 (2 decimales)
     — calcula ICC si vienen cintura_cm y cadera_cm: cintura / cadera (3 decimales)
     — si masa_libre_grasa_kg y peso_kg presentes pero pct_grasa no → pct_grasa = ((peso-mlg)/peso)*100
     — INSERT medicion_antropometrica, devuelve el registro
     — si consulta_id presente → marcar seccion 'antrop' como completa via
       el endpoint PUT /consultas/:id/seccion

GET  /api/pacientes/:pacienteId/antropometria
     query: limite? (default 10, max 50)
     — devuelve historial ordenado por fecha_medicion DESC
     — incluye todos los campos (para la gráfica histórica)

GET  /api/pacientes/:pacienteId/antropometria/ultima
     — devuelve la medicion_antropometrica más reciente
     — 404 si no hay ninguna

GET  /api/pacientes/:pacienteId/antropometria/consulta/:consultaId
     — devuelve la medición asociada a una consulta específica (para modo seguimiento)
```

────────────────────────────────────────────────────────────
PASO 4 — API: BIOQUÍMICA INTEGRADA (EVAL-02)
────────────────────────────────────────────────────────────

No requiere nueva tabla. Extiende la ruta de labs existente:

```
GET  /api/pacientes/:pacienteId/labs/nutricional
     query: dias? (default 90 — busca labs de los últimos N días)
     — SELECT lab_exam JOIN lab_resultado WHERE clinica_id=$1 AND paciente_id=$2
       AND lab_exam.fecha >= NOW() - INTERVAL '$dias days'
       ORDER BY lab_exam.fecha DESC
     — Filtra y clasifica resultados por grupos nutricionales:
       hematologico: ['hemoglobina','hematocrito','vcm','hcm','ferritina','hierro','tibc',
                       'transferrina','vitamina_b12','folato']
       metabolico:   ['glucosa','hba1c','colesterol_total','hdl','ldl','trigliceridos',
                       'insulina','indice_homa']
       proteico:     ['proteinas_totales','albumina','prealbumina','pcr','creatinina']
       vitaminas:    ['vitamina_d','vitamina_b12','folato','zinc','magnesio','calcio',
                       'potasio','sodio','fosforo']
     — Matching por nombre del marcador (case-insensitive LIKE o array de alias)
     — Para cada resultado: agrega estado ('normal'|'bajo'|'alto'|'critico') comparando
       valor vs rango_min/rango_max si existen en lab_resultado
     — devuelve: { hematologico: [...], metabolico: [...], proteico: [...], vitaminas: [...],
                   fecha_mas_reciente, total_marcadores, marcadores_alterados }
```

────────────────────────────────────────────────────────────
PASO 5 — FRONTEND: CONTENEDOR DE VALORACIÓN (EVAL-00)
────────────────────────────────────────────────────────────

Revisa disenos/eval/ antes de implementar.

Crea apps/web-professional/src/pages/ValoracionPaciente.tsx
Crea apps/web-professional/src/components/eval/TabsValoracion.tsx

**ValoracionPaciente.tsx**:
```
Ruta: /pacientes/:pacienteId/valoracion/:consultaId
Props obtenidas desde URL params.

Al montar:
- GET /api/pacientes/:id/consultas/:consultaId → obtiene la consulta con secciones_completas
- GET /api/pacientes/:id (para nombre del paciente en el header)

Layout:
┌────────────────────────────────────────────────────────────────┐
│ HEADER (sticky, 64px)                                          │
│  ← Volver  |  Nombre Paciente  |  Consulta #N · Inicial/Seg.  │
│  Chip estado: "In progress" (amber) / "Completed" (green)      │
│  [Save draft]  [Finalize assessment]                           │
├────────────────────────────────────────────────────────────────┤
│ TabsValoracion (5 tabs con indicador de progreso)             │
├────────────────────────────────────────────────────────────────┤
│ Contenido de la tab activa (renderizado condicional)           │
└────────────────────────────────────────────────────────────────┘

Tabs: Anthropometry | Biochemistry | Clinical | Dietary | Conclusions
Cada tab muestra: icono de check (teal) si secciones_completas[key]=true, else gris

Botón "Finalize assessment":
- Habilitado solo si al menos 'antrop' y 'conclusion' están completos
- Al click: PUT /api/.../finalizar → chip cambia a "Completed" → desactiva edición

Gestión del estado: usa un Context (ValoracionContext) que comparte consultaId,
pacienteId, secciones_completas y una función refrescarSecciones() entre los hijos.
```

**TabsValoracion.tsx**:
```tsx
// Props: tabs: Array<{id, label, completa}>, activa, onCambiar
// Renderiza la barra horizontal de tabs.
// Cada tab: círculo de progreso (teal lleno si completa, gris vacío) + label
// Tab activa: subrayado teal 3px, texto bold
// Responsive: en mobile muestra scroll horizontal de tabs
```

Integración en PacienteFicha.tsx:
- Agrega botón "Nueva consulta" en el encabezado del expediente
- Al click: POST /api/pacientes/:id/consultas → navega a /pacientes/:id/valoracion/:nuevaConsultaId
- Agrega sección "Consultas" con lista de consultas previas (GET /api/pacientes/:id/consultas)
  cada fila con: tipo, número, fecha, estado, botón "Open"

────────────────────────────────────────────────────────────
PASO 6 — FRONTEND: FORMULARIO DE ANTROPOMETRÍA (EVAL-01)
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/eval/FormAntropometria.tsx
Crea apps/web-professional/src/components/eval/GraficaComposicion.tsx

**FormAntropometria.tsx**:
```tsx
// Props: pacienteId, consultaId, onGuardado?
// Al montar: GET /api/pacientes/:id/antropometria/consulta/:consultaId
//            para precargar si ya existe medición en esta consulta.
//            También GET /api/pacientes/:id/antropometria/ultima para precargar
//            valores de la última consulta como referencia.

// SECCIÓN 1 — Medidas básicas (2 columnas):
// Peso (kg) · Talla (cm) → IMC calculado en tiempo real (formula inline, chip auto)
// Cintura (cm) · Cadera (cm) → ICC calculado en tiempo real
// Brazo (cm) · Pierna (cm)

// IMC chip: color según OMS —
//   < 18.5 → amber "Underweight" · 18.5-24.9 → green "Normal"
//   25-29.9 → amber "Overweight" · ≥ 30 → red "Obesity"
// ICC chip: color según sexo (si disponible en paciente):
//   Hombre > 1.0 → red "High risk" · Mujer > 0.85 → red "High risk"

// SECCIÓN 2 — Método de composición corporal:
// Radio pills: "Bioimpedancia (BIA)" | "Pliegues cutáneos"
//
// Si BIA:
//   Masa libre de grasa (kg) · Masa muscular (kg)
//   % Grasa · Masa grasa (kg) → si se llena LBM y peso, calcular %grasa auto
//   Agua corporal (%) · Ángulo de fase (°)
//
// Si Pliegues:
//   7 campos numéricos: Tricipital · Bicipital · Subescapular ·
//     Suprailíaco · Abdominal · Muslo · Pierna (todos en mm)
//   Selector de fórmula: "Durnin-Womersley" (default) | "Jackson-Pollock"
//   % Grasa calculado automáticamente (implementar las fórmulas en utils/composicion.ts)

// SECCIÓN 3 — Histórico (GraficaComposicion si hay ≥ 2 mediciones)
// Si solo una medición → empty state "First measurement recorded"

// Botón "Save anthropometry" → POST /api/pacientes/:id/antropometria
// Feedback: toast "Saved · X kg, IMC Y.Y"
```

**utils/composicion.ts** — calcula % grasa desde pliegues:
```typescript
// Durnin-Womersley (suma 4 pliegues: bicipital, tricipital, subescapular, suprailíaco)
// Jackson-Pollock 3 pliegues (hombre: pectoral+abdominal+muslo; mujer: tricipital+suprailíaco+muslo)
// Exportar: calcularPctGrasaDurninWomersley(pliegues, edad, sexo): number
//           calcularPctGrasaJacksonPollock(pliegues, edad, sexo): number
// Fuente de las ecuaciones: documentación académica pública
```

**GraficaComposicion.tsx**:
```tsx
// Props: mediciones: MedicionAntropometrica[] (ordenadas por fecha ASC)
// Gráfica de área apilada (usa recharts o similar ya instalado en el proyecto):
//   x-axis: fechas de consulta
//   y-axis: kg
//   Área 1 (teal-300): Lean body mass (masa_libre_grasa_kg)
//   Línea (teal-700): Peso total (peso_kg)
//   Área 2 (red-200): Masa grasa (masa_grasa_kg)
// Tooltip al hover: muestra todos los valores de esa medición
// Bajo la gráfica: 3 mini-KPI sparklines — "Body fat %" · "Phase angle" · "Waist (cm)"
// Si < 2 mediciones: no renderiza la gráfica
```

────────────────────────────────────────────────────────────
PASO 7 — FRONTEND: PANEL BIOQUÍMICA (EVAL-02)
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/eval/PanelBioquimica.tsx

```tsx
// Props: pacienteId, consultaId
// Al montar: GET /api/pacientes/:id/labs/nutricional?dias=90
//
// Si no hay labs:
//   Banner amber "No lab results in the last 90 days."
//   Link "Upload labs →" (navega a la sección de labs del expediente)
//
// Si hay labs:
//   Header: "Labs from [fecha_mas_reciente]" + link "View all labs ↗"
//   Chips de resumen: "X markers flagged" (rojo si hay críticos, amber si hay alterados, verde si todos normales)
//
//   4 acordeones colapsables (header teal-50):
//     1. HEMATOLÓGICOS
//     2. METABÓLICOS
//     3. ESTADO PROTEICO
//     4. VITAMINAS Y MINERALES
//
//   Cada acordeón expandido: tabla con columnas —
//     Marcador | Resultado | Unidad | Rango ref. | Estado (chip)
//   Chips de estado:
//     'normal'  → green-100 text-green-700
//     'bajo'    → amber-100 text-amber-700
//     'alto'    → amber-100 text-amber-700
//     'critico' → red-100 text-red-700
//   Acordeones con marcadores alterados se expanden automáticamente al cargar.
//
//   Sección "Summary flags":
//     Nube de chips con los marcadores alterados (amber/rojo según severidad)
//     Si todos normales: chip verde "No nutritional flags"
//
// Botón "Mark biochemistry complete" →
//   PUT /api/.../consultas/:cid/seccion { seccion: 'bioquim', completa: true }
//   Solo visible si hay al menos 1 lab cargado
```

────────────────────────────────────────────────────────────
PASO 8 — INTEGRACIÓN EN ValoracionPaciente
────────────────────────────────────────────────────────────

En ValoracionPaciente.tsx, el renderizado condicional por tab activa:

```tsx
{tabActiva === 'antrop'   && <FormAntropometria pacienteId={pacienteId} consultaId={consultaId} />}
{tabActiva === 'bioquim'  && <PanelBioquimica   pacienteId={pacienteId} consultaId={consultaId} />}
{tabActiva === 'clinico'  && <div>Coming in R14</div>}
{tabActiva === 'dietetico'&& <div>Coming in R14</div>}
{tabActiva === 'conclusion'&& <div>Coming in R15</div>}
```

Los tabs Clínico, Dietético y Conclusiones muestran un placeholder "In development"
para que el router ya esté armado y listo para las siguientes rebanadas.

────────────────────────────────────────────────────────────
PASO 9 — PRUEBAS.md — SECCIÓN R13
────────────────────────────────────────────────────────────

Agrega al final de docs/PRUEBAS.md:

```markdown
## R13 — Valoración ABCD: contenedor + Antropometría + Bioquímica (EVAL-00, EVAL-01, EVAL-02)

### EVAL-00 · Contenedor de valoración

- [ ] CA-13-01 Botón "Nueva consulta" en PacienteFicha crea una consulta y navega a /valoracion/:id.
- [ ] CA-13-02 Si el paciente ya tiene una consulta finalizada, la nueva se crea como tipo='seguimiento'.
- [ ] CA-13-03 El numero_consulta se incrementa correctamente (primera=1, segunda=2, etc.).
- [ ] CA-13-04 TabsValoracion muestra check teal en tabs completadas (secciones_completas).
- [ ] CA-13-05 "Finalize assessment" está deshabilitado si 'antrop' no está completo.
- [ ] CA-13-06 PUT /finalizar cambia estado a 'finalizada' y el chip del header lo refleja.
- [ ] CA-13-07 Intentar finalizar una consulta de otra clínica devuelve 403 o 404.

### EVAL-01 · Antropometría

- [ ] CA-13-08 Guardar peso y talla calcula el IMC correctamente (ejemplo: 78kg, 165cm → 28.7).
- [ ] CA-13-09 Guardar cintura y cadera calcula el ICC.
- [ ] CA-13-10 Método BIA: guardar LBM y peso calcula %grasa automáticamente si no se provee.
- [ ] CA-13-11 Método pliegues: ingresar 4 pliegues calcula %grasa con Durnin-Womersley.
- [ ] CA-13-12 GET /antropometria devuelve historial ordenado por fecha DESC.
- [ ] CA-13-13 GraficaComposicion aparece cuando hay ≥ 2 mediciones.
- [ ] CA-13-14 Guardar la medición marca la sección 'antrop' como completa en la consulta.
- [ ] CA-13-15 IMC fuera de rango normal muestra el chip con el color correcto.

### EVAL-02 · Bioquímica

- [ ] CA-13-16 GET /labs/nutricional filtra y clasifica correctamente los marcadores por grupo.
- [ ] CA-13-17 Marcador con valor > rango_max queda marcado como 'alto'.
- [ ] CA-13-18 Los acordeones con marcadores alterados se expanden automáticamente.
- [ ] CA-13-19 PanelBioquimica muestra banner vacío si no hay labs en los últimos 90 días.
- [ ] CA-13-20 "Mark biochemistry complete" actualiza secciones_completas correctamente.
```

────────────────────────────────────────────────────────────
PASO 10 — COMMIT
────────────────────────────────────────────────────────────

  npm run lint --prefix apps/api
  npm run lint --prefix apps/web-professional
  npm run build --prefix apps/api

  git add apps/api/migrations/016_eval_base.sql
  git add apps/api/src/routes/consultas.ts
  git add apps/api/src/routes/antropometria.ts   # o como lo hayas nombrado
  git add apps/web-professional/src/pages/ValoracionPaciente.tsx
  git add apps/web-professional/src/components/eval/
  git add apps/web-professional/src/utils/composicion.ts
  git add docs/PRUEBAS.md
  # Si modificaste PacienteFicha o el router:
  git add apps/web-professional/src/pages/PacienteFicha.tsx
  git add apps/web-professional/src/App.tsx

  git commit -m "R13: valoración ABCD — contenedor, antropometría e integración bioquímica (EVAL-00, EVAL-01, EVAL-02)"

Reporta el hash del commit al finalizar.
