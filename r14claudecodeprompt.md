Lee docs/REBANADA-09.md para entender el contexto del proyecto. Esta es la
Rebanada 14: Clínico/Historial + Farmacología + Evaluación Dietética
(EVAL-03, EVAL-04).

Requisito previo: R13 completada (tablas consulta y medicion_antropometrica existen,
ruta /pacientes/:id/valoracion/:consultaId funciona con tabs A y B).

────────────────────────────────────────────────────────────
ANTES DE ESCRIBIR CUALQUIER CÓDIGO — leer estas referencias
────────────────────────────────────────────────────────────

1. Lee apps/api/src/routes/consultas.ts (creado en R13) — patrón de ruta
   y función helper para marcar secciones como completas.
2. Lee apps/api/src/routes/planes.ts — patrón de auth: resolverAlcance,
   clinica_id desde JWT, profesional_id desde keycloak_user_id.
3. Lee apps/api/migrations/ — confirma que la última migración es 016.
   La tuya será 017_eval_clinico.sql.
4. Lee apps/web-professional/src/components/eval/ — revisa lo que ya existe
   en la carpeta (FormAntropometria, etc.) para mantener consistencia de estilo.
5. Revisa disenos/eval/ — diseños de FormHistorialClinico, FormFarmacologia,
   FormR24h, FormFrecuencia y ResumenDietetico.

────────────────────────────────────────────────────────────
PASO 1 — MIGRACIÓN 017: HISTORIAL CLÍNICO Y EVALUACIÓN DIETÉTICA
────────────────────────────────────────────────────────────

Archivo: apps/api/migrations/017_eval_clinico.sql

```sql
-- migration: 017_eval_clinico

CREATE TABLE historial_clinico (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id              UUID        NOT NULL REFERENCES clinica(id),
  paciente_id             UUID        NOT NULL REFERENCES paciente(id),
  consulta_id             UUID        REFERENCES consulta(id),
  profesional_id          UUID        NOT NULL REFERENCES profesional(id),

  -- APF: [{ condicion: 'diabetes', parientes: 'madre, padre' }, ...]
  apf                     JSONB       NOT NULL DEFAULT '[]',
  -- APP: [{ condicion: 'hipertension', desde: '2020' }, ...]
  app                     JSONB       NOT NULL DEFAULT '[]',

  -- Actividad física
  tipo_actividad          TEXT,
  -- 'sedentario'|'leve'|'moderado'|'intenso'|'muy_intenso'
  sesiones_semana         INT,
  duracion_min            INT,        -- duración promedio en minutos
  faf                     NUMERIC(4,3), -- factor de actividad calculado
  actividad_detalle       TEXT,

  -- Sustancias
  fuma                    BOOLEAN,
  alcohol                 BOOLEAN,
  otras_sustancias        TEXT,

  -- Salud gastrointestinal: ['bloating','constipation','diarrhea','gerd','ibs', ...]
  sintomas_gi             JSONB       NOT NULL DEFAULT '[]',
  gi_detalle              TEXT,

  -- Relación con alimentos (Likert 1-5, null si no respondido)
  alimentacion_emocional  SMALLINT    CHECK (alimentacion_emocional BETWEEN 1 AND 5),
  salteo_comidas          SMALLINT    CHECK (salteo_comidas BETWEEN 1 AND 5),
  atracones               SMALLINT    CHECK (atracones BETWEEN 1 AND 5),
  culpa_al_comer          SMALLINT    CHECK (culpa_al_comer BETWEEN 1 AND 5),
  dietas_frecuentes       SMALLINT    CHECK (dietas_frecuentes BETWEEN 1 AND 5),

  notas_adicionales       TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_historial_paciente
  ON historial_clinico (clinica_id, paciente_id, created_at DESC);

CREATE TABLE farmacologia (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      UUID        NOT NULL REFERENCES clinica(id),
  paciente_id     UUID        NOT NULL REFERENCES paciente(id),
  nombre          TEXT        NOT NULL,
  dosis           TEXT,
  frecuencia      TEXT,
  desde           DATE,
  activo          BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_farm_paciente
  ON farmacologia (clinica_id, paciente_id, activo);

CREATE TABLE evaluacion_dietetica (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id          UUID        NOT NULL REFERENCES clinica(id),
  paciente_id         UUID        NOT NULL REFERENCES paciente(id),
  consulta_id         UUID        REFERENCES consulta(id),
  profesional_id      UUID        NOT NULL REFERENCES profesional(id),

  -- Recordatorio 24h como array de comidas
  -- [{ hora:'07:00', tipo:'desayuno', alimentos:[{nombre,cantidad,unidad,kcal?}], kcal_estimadas }]
  recordatorio_24h    JSONB       NOT NULL DEFAULT '[]',

  -- Frecuencia de consumo: { 'cereales': '4-6xsemana', 'carnes_rojas': '1xsemana', ... }
  frecuencia_consumo  JSONB       NOT NULL DEFAULT '{}',

  -- Hidratación
  hidratacion_litros  NUMERIC(4,2),

  -- Estimación total de macros (calculada a partir del R24h o declarada)
  kcal_estimadas      INT,
  proteina_g          NUMERIC(6,2),
  cho_g               NUMERIC(6,2),
  grasa_g             NUMERIC(6,2),
  fibra_g             NUMERIC(6,2),

  notas_dieteticas    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dietetico_paciente
  ON evaluacion_dietetica (clinica_id, paciente_id, created_at DESC);
```

Ejecuta npm run migrate y confirma las tres tablas.

────────────────────────────────────────────────────────────
PASO 2 — API: HISTORIAL CLÍNICO Y FARMACOLOGÍA (EVAL-03)
────────────────────────────────────────────────────────────

Crea apps/api/src/routes/historial.ts y regístrala en server.ts con prefix '/api'.

```
PUT  /api/pacientes/:pacienteId/historial
     body: (cualquier subconjunto de los campos de historial_clinico)
     — resuelve profesional_id desde JWT sub
     — verifica paciente pertenece a la clínica (resolverAlcance → 404)
     — INSERT ... ON CONFLICT (clinica_id, paciente_id) — usar UPSERT:
       Si ya existe un historial_clinico para el paciente: UPDATE
       Si no existe: INSERT
       (un paciente tiene un solo historial, que se actualiza consulta a consulta)
     — si viene consulta_id en body: marcar sección 'clinico' como completa
     — devuelve el historial actualizado

GET  /api/pacientes/:pacienteId/historial
     — devuelve el historial_clinico del paciente (el registro único)
     — 404 si no existe aún

-- NOTA: historial_clinico tiene un solo registro por paciente que se actualiza
-- en cada consulta (a diferencia de medicion_antropometrica que crea una fila nueva).
-- El campo consulta_id registra en qué consulta fue la última actualización.

--- Farmacología ---

GET  /api/pacientes/:pacienteId/farmacologia
     — devuelve medicamentos activos (activo=true) ORDER BY created_at DESC
     — incluye también los inactivos si query param: incluir_inactivos=true

POST /api/pacientes/:pacienteId/farmacologia
     body: { nombre, dosis?, frecuencia?, desde? }
     — INSERT farmacologia
     — devuelve el registro creado

PUT  /api/pacientes/:pacienteId/farmacologia/:medId
     body: { nombre?, dosis?, frecuencia?, desde? }
     — UPDATE campos provistos
     — verifica clinica_id de la fila = JWT tenantId
     — devuelve registro actualizado

DELETE /api/pacientes/:pacienteId/farmacologia/:medId
     — soft delete: UPDATE activo=false
     — devuelve { ok: true }

GET  /api/pacientes/:pacienteId/farmacologia/interacciones
     — Lee todos los medicamentos activos del paciente
     — Consulta una tabla de interacciones (ver implementación abajo)
     — Devuelve array de interacciones detectadas

-- Tabla de interacciones (hardcoded en código, no en DB):
-- Implementar en apps/api/src/clinico/interacciones.ts
-- Map de medicamento → nutriente afectado → tipo → recomendación:
--   metformina       → vitamina_b12 → absorcion_reducida → "Monitor B12. Niveles pueden disminuir con uso prolongado."
--   levotiroxina     → calcio/hierro → absorcion_reducida → "Administrar 30-60 min antes de comidas. Evitar lácteos y suplementos de hierro simultáneos."
--   warfarina        → vitamina_k   → interferencia      → "Mantener consumo constante de vitamina K. No aumentar ni disminuir bruscamente."
--   atorvastatina    → coenzima_q10 → deplecion          → "Puede reducir CoQ10. Considerar suplementación."
--   omeprazol        → vitamina_b12/magnesio → absorcion_reducida → "Con uso crónico (>1 año), monitorear B12 y Mg."
--   corticosteroides → calcio/vitamina_d/potasio → multiples → "Aumentar Ca/VitD. Monitorear glucosa y potasio."
-- Matching: case-insensitive, busca si el nombre del medicamento LIKE '%keyword%'
-- Devuelve: [{ medicamento, nutriente, tipo, recomendacion, severidad: 'info'|'warning'|'critical' }]
```

────────────────────────────────────────────────────────────
PASO 3 — API: EVALUACIÓN DIETÉTICA (EVAL-04)
────────────────────────────────────────────────────────────

Crea apps/api/src/routes/dietetico.ts y regístrala en server.ts con prefix '/api'.

```
PUT  /api/pacientes/:pacienteId/dietetico
     body: {
       consulta_id?,
       recordatorio_24h?,   -- array de comidas (ver estructura JSONB arriba)
       frecuencia_consumo?,  -- objeto grupo→frecuencia
       hidratacion_litros?,
       kcal_estimadas?, proteina_g?, cho_g?, grasa_g?, fibra_g?,
       notas_dieteticas?
     }
     — UPSERT (como historial_clinico): un registro por paciente, actualizable
     — si viene consulta_id: marcar sección 'dietetico' como completa
     — devuelve la evaluación actualizada

GET  /api/pacientes/:pacienteId/dietetico
     — devuelve la evaluación dietética del paciente
     — 404 si no existe
```

────────────────────────────────────────────────────────────
PASO 4 — FRONTEND: HISTORIAL CLÍNICO (EVAL-03)
────────────────────────────────────────────────────────────

Revisa disenos/eval/ antes de implementar.

Crea apps/web-professional/src/components/eval/FormHistorialClinico.tsx
Crea apps/web-professional/src/components/eval/FormFarmacologia.tsx
Crea apps/web-professional/src/components/eval/InteraccionesPanel.tsx

**FormHistorialClinico.tsx**:
```tsx
// Props: pacienteId, consultaId
// Al montar: GET /api/pacientes/:id/historial (precargar si existe)
//            GET /api/pacientes/:id/farmacologia (para sección farmacología)

// LAYOUT: sidebar de ancla (160px, fija) + contenido scrolleable (derecha)
// El sidebar lista las secciones con indicador de llenado (●/○):
//   APF · APP · Actividad física · Sustancias · Salud GI · Relación con alimentos

// SECCIÓN APF — Antecedentes patológicos familiares:
//   Grid de checkboxes (2 columnas):
//     Diabetes T2 · Hipertensión · Dislipidemia · Obesidad ·
//     Enfermedad cardiovascular · Cáncer · Tiroides · Osteoporosis
//   Cada checkbox: al marcar, aparece campo inline "¿Qué familiar?" (input text 60px)
//   Almacena como apf: [{ condicion: 'diabetes', parientes: 'madre' }]

// SECCIÓN APP — Antecedentes patológicos personales:
//   Mismo patrón de checkboxes sin campo de familiar.
//   Campo "Otras condiciones" (text, libre)

// SECCIÓN Actividad física:
//   Selector de tipo (5 radio cards horizontales con descripción):
//     1.20 Sedentario · 1.375 Leve · 1.55 Moderado · 1.725 Muy activo · 1.90 Extra activo
//   Cada card: etiqueta + descripción corta ("Desk job, < 1h walk")
//   Sesiones/semana (stepper 0-14) · Duración promedio (dropdown 30/45/60/90/120+ min)
//   FAF calculado automáticamente (chip teal: "FAF: 1.55")
//   Textarea "Detalles de actividad" (opcional)

// SECCIÓN Sustancias:
//   Toggle ¿Fuma? (Sí/No) · Toggle ¿Alcohol? (Sí/No)
//   Textarea "Otras sustancias" (opcional)

// SECCIÓN Salud gastrointestinal:
//   Radio "¿Presenta síntomas GI?" (Sí/No)
//   Si Sí: checkboxes —
//     Distensión · Estreñimiento · Diarrea · ERGE/acidez · SII ·
//     Enfermedad inflamatoria intestinal · Intolerancia alimentaria · Otro
//   Textarea "Detalles" (visible si algo marcado)

// SECCIÓN Relación con alimentos (Likert 1-5):
//   5 filas, cada una:
//     Label | [Nunca · Casi nunca · A veces · Frecuentemente · Siempre]
//   Ítems: Alimentación emocional · Salteo comidas · Atracones ·
//           Culpa al comer · Dietas frecuentes
//   Nota al pie: "Solo tamizaje — no es una herramienta clínica validada"

// Botón "Save clinical history" → PUT /api/pacientes/:id/historial
// Botón "Mark section complete" → marca 'clinico' en secciones_completas
```

**FormFarmacologia.tsx**:
```tsx
// Props: pacienteId
// Al montar: GET /api/pacientes/:id/farmacologia

// Tabla de medicamentos activos:
//   Columnas: Nombre | Dosis | Frecuencia | Desde | Acciones (editar/eliminar)
//   Filas editables inline al hacer click en editar
//   Eliminar → PUT activo=false (soft delete, desaparece de la lista)

// Botón "+ Agregar medicamento" → fila nueva al final de la tabla con campos vacíos
//   Al confirmar → POST /api/pacientes/:id/farmacologia

// Al cambiar cualquier medicamento → re-fetch de interacciones

// Componente InteraccionesPanel justo debajo de la tabla
```

**InteraccionesPanel.tsx**:
```tsx
// Props: pacienteId
// Al montar y cuando cambia la lista de fármacos:
//   GET /api/pacientes/:id/farmacologia/interacciones
//
// Si no hay interacciones: chip verde "No significant drug-nutrient interactions detected"
// Si hay interacciones: lista de cards —
//   info     → teal-50  bg, texto muted (informativo)
//   warning  → amber-50 bg, icono ⚠ (moderado)
//   critical → red-50   bg, icono ⛔ (importante)
//   Cada card: medicamento → nutriente afectado · recomendación
//   Link "Add to notes" → agrega la interacción al textarea de notas del historial
// Disclaimer pie: "Basado en base de datos NutriSmart. No reemplaza el juicio clínico."
```

────────────────────────────────────────────────────────────
PASO 5 — FRONTEND: EVALUACIÓN DIETÉTICA (EVAL-04)
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/eval/FormR24h.tsx
Crea apps/web-professional/src/components/eval/FormFrecuenciaConsumo.tsx
Crea apps/web-professional/src/components/eval/ResumenDietetico.tsx
Crea apps/web-professional/src/components/eval/TabsDietetico.tsx

**TabsDietetico.tsx** — contenedor con 3 sub-tabs:
```
[Recordatorio 24h] [Frecuencia de consumo] [Resumen y macros]
```

**FormR24h.tsx**:
```tsx
// Props: pacienteId, consultaId, onChange: (datos) => void
// Estado local: meals[] inicializado desde GET /api/pacientes/:id/dietetico si existe

// TIMELINE VERTICAL:
// Cada comida = card expandible:
//   Header: hora (time input editable) · tipo (dropdown: desayuno/media_mañana/almuerzo/
//            merienda/cena/extra) · kcal estimadas (badge auto-actualizable) · ▼ expandir
//   Expanded: tabla de alimentos con filas —
//     Alimento (text) | Cantidad (number) | Unidad (dropdown: g/ml/porción/taza/cdta)
//     Al final de cada fila: kcal estimadas manuales (campo numérico opcional)
//   Botón "+ Añadir alimento" al fondo de la tabla
//   Botón "- Eliminar comida" en el header

// Botón "+ Añadir comida" al final del timeline → agrega card nueva
// Total diario en sidebar derecha (280px):
//   kcal total (suma de kcal_estimadas de todas las comidas)
//   Barras de progreso: proteína (g) / CHO (g) / grasa (g) / fibra (g)
//   Los totales de macros solo si el profesional los ingresó manualmente en ResumenDietetico

// Al cambiar cualquier dato → dispara onChange con el array de comidas actualizado
// No hace petición al API por cada keystroke; el padre TabsDietetico guarda en bulk
```

**FormFrecuenciaConsumo.tsx**:
```tsx
// Props: datos: object, onChange: (datos) => void
//
// Tabla/grid — filas: grupos de alimentos · columnas: frecuencias
// GRUPOS (con color de semáforo):
//   Verde:  Cereales y tubérculos · Legumbres · Proteína animal magra (pollo/pavo/pescado) ·
//           Huevos · Lácteos bajos en grasa · Verduras · Frutas ·
//           Grasas saludables (aceite oliva, aguacate, nueces)
//   Ámbar:  Carnes rojas · Lácteos enteros
//   Rojo:   Carnes procesadas · Bebidas azucaradas · Alcohol · Ultraprocesados
// FRECUENCIAS: Nunca · 1-2×/mes · 1×/sem · 2-3×/sem · 4-6×/sem · Diario · >1×/día
//
// Celda = radio button, seleccionada = teal-50 bg
// Label izquierdo de filas rojas en red-700
//
// Al seleccionar cualquier radio → dispara onChange
```

**ResumenDietetico.tsx**:
```tsx
// Props: pacienteId, r24h, frecuencia, onChange: (macros) => void
//
// DOS COLUMNAS:
// Izquierda "Consumo estimado":
//   Donut chart (Recharts PieChart):
//     Proteína % (teal) · CHO % (blue) · Grasa % (amber)
//   Total kcal en el centro del donut
//   Tabla: Nutriente | Cantidad | % | kcal
//
//   Campos editables manuales (el profesional puede ajustar):
//     Kcal totales · Proteína (g) · CHO (g) · Grasa (g) · Fibra (g)
//   Nota: "Estimated from 24h recall. Adjust if needed."
//
// Derecha "Comparativo vs. necesidades":
//   Si hay calculadora completada (EVAL-06, llega en R15):
//     Tabla: Nutriente | Actual | Meta | Gap | Estado (chip)
//   Si no: Banner teal-50 "Complete the nutritional calculator in the
//          Conclusions tab to compare against goals."
//
// Botón "Save dietary assessment" →
//   PUT /api/pacientes/:id/dietetico (guarda r24h + frecuencia + macros + consulta_id)
//   + marca 'dietetico' como completo
```

────────────────────────────────────────────────────────────
PASO 6 — INTEGRACIÓN EN ValoracionPaciente
────────────────────────────────────────────────────────────

Reemplaza los placeholders de R13 en ValoracionPaciente.tsx:

```tsx
{tabActiva === 'clinico'   && (
  <div className="space-y-6">
    <FormHistorialClinico pacienteId={pacienteId} consultaId={consultaId} />
    <FormFarmacologia pacienteId={pacienteId} />
  </div>
)}
{tabActiva === 'dietetico' && (
  <TabsDietetico pacienteId={pacienteId} consultaId={consultaId} />
)}
```

────────────────────────────────────────────────────────────
PASO 7 — PRUEBAS.md — SECCIÓN R14
────────────────────────────────────────────────────────────

Agrega al final de docs/PRUEBAS.md:

```markdown
## R14 — Valoración ABCD: Historial clínico + Evaluación dietética (EVAL-03, EVAL-04)

### EVAL-03 · Historial clínico y farmacología

- [ ] CA-14-01 PUT /historial guarda APF correctamente como JSONB.
- [ ] CA-14-02 El historial es UPSERT: guardar dos veces el mismo paciente actualiza, no duplica.
- [ ] CA-14-03 FAF se calcula correctamente según tipo de actividad seleccionado.
- [ ] CA-14-04 POST /farmacologia agrega un medicamento y aparece en la tabla.
- [ ] CA-14-05 DELETE soft de medicamento → desaparece de la lista (activo=false).
- [ ] CA-14-06 GET /farmacologia/interacciones detecta metformina→B12 cuando está en la lista.
- [ ] CA-14-07 InteraccionesPanel muestra cards amber para warnings y rojo para critical.
- [ ] CA-14-08 Guardar historial con consulta_id marca sección 'clinico' como completa.
- [ ] CA-14-09 Likert de relación con alimentos acepta valores 1-5 solamente.

### EVAL-04 · Evaluación dietética

- [ ] CA-14-10 FormR24h permite agregar comidas y alimentos dinámicamente.
- [ ] CA-14-11 El total de kcal del día se actualiza en tiempo real al agregar alimentos.
- [ ] CA-14-12 PUT /dietetico guarda el recordatorio 24h como JSONB con la estructura correcta.
- [ ] CA-14-13 FormFrecuenciaConsumo selecciona un radio por fila y actualiza los datos.
- [ ] CA-14-14 ResumenDietetico muestra el donut chart con los porcentajes de macros.
- [ ] CA-14-15 PUT /dietetico es UPSERT: guardar dos veces actualiza sin duplicar.
- [ ] CA-14-16 Guardar con consulta_id marca sección 'dietetico' como completa en la consulta.
- [ ] CA-14-17 Intentar guardar historial/dietetico de paciente de otra clínica → 404.
```

────────────────────────────────────────────────────────────
PASO 8 — COMMIT
────────────────────────────────────────────────────────────

  npm run lint --prefix apps/api
  npm run lint --prefix apps/web-professional
  npm run build --prefix apps/api

  git add apps/api/migrations/017_eval_clinico.sql
  git add apps/api/src/routes/historial.ts
  git add apps/api/src/routes/dietetico.ts
  git add apps/api/src/clinico/interacciones.ts
  git add apps/web-professional/src/components/eval/FormHistorialClinico.tsx
  git add apps/web-professional/src/components/eval/FormFarmacologia.tsx
  git add apps/web-professional/src/components/eval/InteraccionesPanel.tsx
  git add apps/web-professional/src/components/eval/FormR24h.tsx
  git add apps/web-professional/src/components/eval/FormFrecuenciaConsumo.tsx
  git add apps/web-professional/src/components/eval/ResumenDietetico.tsx
  git add apps/web-professional/src/components/eval/TabsDietetico.tsx
  git add apps/web-professional/src/pages/ValoracionPaciente.tsx
  git add docs/PRUEBAS.md

  git commit -m "R14: valoración ABCD — historial clínico, farmacología e interacciones, evaluación dietética (EVAL-03, EVAL-04)"

Reporta el hash del commit al finalizar.
