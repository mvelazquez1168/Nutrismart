Lee docs/REBANADA-09.md para entender el contexto del proyecto. Esta es la
Rebanada 15: Conclusiones clínicas + Calculadora nutricional + Plan prescrito
(EVAL-05, EVAL-06, EVAL-07).

Requisito previo: R14 completada (tabs Clínico y Dietético funcionan en ValoracionPaciente).

────────────────────────────────────────────────────────────
ANTES DE ESCRIBIR CUALQUIER CÓDIGO — leer estas referencias
────────────────────────────────────────────────────────────

1. Lee apps/api/src/routes/planes.ts — patrón de auth y estructura de plan_alimentario.
   EVAL-07 muestra el plan activo en la valoración (read-only aquí).
2. Lee apps/api/src/routes/consultas.ts — helper de marcar secciones completas.
3. Lee apps/api/migrations/ — confirma que la última migración es 017.
   La tuya será 018_eval_conclusion.sql.
4. Lee apps/web-professional/src/components/eval/ — FormAntropometria como
   referencia de estilo para la sección de conclusiones.
5. Revisa disenos/eval/ — diseños de FormConclusion, PanelCalculadora y ResumenPlanPrescrito.

────────────────────────────────────────────────────────────
PASO 1 — MIGRACIÓN 018: CONCLUSIONES DE LA VALORACIÓN
────────────────────────────────────────────────────────────

Archivo: apps/api/migrations/018_eval_conclusion.sql

```sql
-- migration: 018_eval_conclusion

CREATE TABLE conclusion_valoracion (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id              UUID        NOT NULL REFERENCES clinica(id),
  paciente_id             UUID        NOT NULL REFERENCES paciente(id),
  consulta_id             UUID        NOT NULL REFERENCES consulta(id),
  profesional_id          UUID        NOT NULL REFERENCES profesional(id),

  -- Diagnóstico nutricional
  diagnostico_principal   TEXT,
  diagnostico_cie10       TEXT,       -- ej: 'E44.1'
  diagnostico_secundario  TEXT,

  -- Observaciones clínicas libres
  observaciones_clinicas  TEXT,

  -- Recomendaciones: ['Aumentar proteína', 'Hidratación 2L/día', ...]
  recomendaciones         JSONB       NOT NULL DEFAULT '[]',

  -- Prescripción dietética
  kcal_prescritas         INT,
  pct_proteina            INT         CHECK (pct_proteina BETWEEN 0 AND 100),
  pct_cho                 INT         CHECK (pct_cho BETWEEN 0 AND 100),
  pct_grasa               INT         CHECK (pct_grasa BETWEEN 0 AND 100),
  proteina_g              NUMERIC(6,2),   -- calculado
  cho_g                   NUMERIC(6,2),
  grasa_g                 NUMERIC(6,2),
  restricciones           JSONB       NOT NULL DEFAULT '[]',
  -- ['sin_gluten','sin_lactosa','bajo_sodio','bajo_grasa','diabetica','vegetariana','vegana','renal']
  suplementos             TEXT,

  -- Acuerdos con el paciente: [{ texto: 'Registrar comidas...', cumplido: false }]
  acuerdos                JSONB       NOT NULL DEFAULT '[]',

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un solo registro de conclusión por consulta
CREATE UNIQUE INDEX uq_conclusion_consulta ON conclusion_valoracion (consulta_id);

CREATE INDEX idx_conclusion_paciente
  ON conclusion_valoracion (clinica_id, paciente_id, created_at DESC);
```

Ejecuta npm run migrate y confirma la tabla.

────────────────────────────────────────────────────────────
PASO 2 — API: CONCLUSIONES (EVAL-05)
────────────────────────────────────────────────────────────

Agrega a apps/api/src/routes/consultas.ts (o crea consultas-conclusion.ts):

```
PUT  /api/pacientes/:pacienteId/consultas/:consultaId/conclusion
     body: {
       diagnostico_principal?, diagnostico_cie10?, diagnostico_secundario?,
       observaciones_clinicas?,
       recomendaciones?,        -- array de strings
       kcal_prescritas?, pct_proteina?, pct_cho?, pct_grasa?,
       restricciones?,          -- array de strings del enum
       suplementos?,
       acuerdos?                -- array de { texto, cumplido }
     }
     — verifica que consulta pertenece a la clínica (clinica_id del JWT)
     — verifica que el profesional resuelto sea el autor de la consulta
     — si pct_proteina + pct_cho + pct_grasa están todos presentes y kcal_prescritas:
         calcula proteina_g = kcal * pct_proteina/100 / 4
         calcula cho_g      = kcal * pct_cho/100 / 4
         calcula grasa_g    = kcal * pct_grasa/100 / 9
     — UPSERT (INSERT ... ON CONFLICT (consulta_id) DO UPDATE SET ...)
     — UPDATE consulta.secciones_completas marcando 'conclusion' = true
     — devuelve la conclusion_valoracion actualizada

GET  /api/pacientes/:pacienteId/consultas/:consultaId/conclusion
     — devuelve la conclusion_valoracion de esa consulta
     — 404 si no existe aún
```

────────────────────────────────────────────────────────────
PASO 3 — CALCULADORA NUTRICIONAL (EVAL-06) — SOLO FRONTEND
────────────────────────────────────────────────────────────

La calculadora es 100% frontend (math en el cliente). No requiere API ni DB.

Crea apps/web-professional/src/utils/calculadora.ts

```typescript
// Fórmulas de TMB (Tasa Metabólica Basal):

export function mifflinStJeor(peso: number, talla: number, edad: number, sexo: 'M'|'F'): number {
  // TMB = (10 × peso_kg) + (6.25 × talla_cm) − (5 × edad) + [5 si hombre | −161 si mujer]
  const base = 10 * peso + 6.25 * talla - 5 * edad;
  return sexo === 'M' ? base + 5 : base - 161;
}

export function harrisBenedict(peso: number, talla: number, edad: number, sexo: 'M'|'F'): number {
  // Hombre: 88.362 + (13.397 × peso) + (4.799 × talla) − (5.677 × edad)
  // Mujer:  447.593 + (9.247 × peso) + (3.098 × talla) − (4.330 × edad)
  if (sexo === 'M') return 88.362 + 13.397 * peso + 4.799 * talla - 5.677 * edad;
  return 447.593 + 9.247 * peso + 3.098 * talla - 4.33 * edad;
}

export function katchMcArdle(mlg: number): number {
  // TMB = 370 + (21.6 × MLG_kg)
  return 370 + 21.6 * mlg;
}

// Factores de actividad (FAF):
export const FAF_VALORES = {
  sedentario:    1.2,
  leve:          1.375,
  moderado:      1.55,
  muy_activo:    1.725,
  extra_activo:  1.9,
};

export function calcularTEE(tmb: number, faf: number): number {
  return Math.round(tmb * faf);
}

// Peso ideal (Hamwi):
export function pesoIdealHamwi(talla: number, sexo: 'M'|'F'): number {
  // Hombre: 48 kg base para 152 cm + 1.1 kg por cm adicional
  // Mujer:  45.4 kg base para 152 cm + 0.9 kg por cm adicional
  const extra = talla - 152;
  if (sexo === 'M') return 48 + 1.1 * extra;
  return 45.4 + 0.9 * extra;
}

// Peso ajustado (cuando peso real > peso ideal + 20%):
export function pesoAjustado(pesoReal: number, pesoIdeal: number): number | null {
  if (pesoReal > pesoIdeal * 1.2) {
    return pesoIdeal + 0.25 * (pesoReal - pesoIdeal);
  }
  return null;
}

// Distribución de macros en gramos desde kcal y porcentajes:
export function calcularMacrosGramos(kcal: number, pctProt: number, pctCho: number, pctGrasa: number) {
  return {
    proteina_g: Math.round((kcal * pctProt / 100) / 4 * 10) / 10,
    cho_g:      Math.round((kcal * pctCho / 100) / 4 * 10) / 10,
    grasa_g:    Math.round((kcal * pctGrasa / 100) / 9 * 10) / 10,
  };
}

// Intercambios ADA (aproximación):
export function calcularIntercambiosADA(kcal: number) {
  // Proporciones aproximadas de una dieta balanceada:
  return {
    almidones:   Math.round(kcal * 0.30 / 80),   // 80 kcal por intercambio
    carnes:      Math.round(kcal * 0.20 / 55),   // 55 kcal promedio
    vegetales:   Math.round(kcal * 0.05 / 25),   // 25 kcal por intercambio
    frutas:      Math.round(kcal * 0.07 / 60),   // 60 kcal por intercambio
    leche:       Math.round(kcal * 0.08 / 90),   // 90 kcal promedio
    grasas:      Math.round(kcal * 0.10 / 45),   // 45 kcal por intercambio
  };
}

// Regla de las 7700 kcal (deficit/superávit → cambio de peso):
export function regla7700(deficitDiario: number): { diasPor1kg: number; kgPorSemana: number } {
  const diasPor1kg = deficitDiario !== 0 ? Math.abs(7700 / deficitDiario) : Infinity;
  const kgPorSemana = 7 / diasPor1kg;
  return { diasPor1kg: Math.round(diasPor1kg * 10) / 10, kgPorSemana: Math.round(kgPorSemana * 100) / 100 };
}

// Conversores:
export function azucarATeaspoons(gramosDia: number): { cucharaditas: number; kcal: number; excedeOMS: boolean } {
  return {
    cucharaditas: Math.round(gramosDia / 5 * 10) / 10,
    kcal: gramosDia * 4,
    excedeOMS: gramosDia > 25,
  };
}

export function sodioASal(mgSodioDia: number): { grSal: number; excedeOMS: boolean } {
  return {
    grSal: Math.round(mgSodioDia / 400 * 10) / 10,   // 1g sal ≈ 400mg sodio
    excedeOMS: mgSodioDia > 2000,
  };
}
```

Crea apps/web-professional/src/components/eval/PanelCalculadora.tsx

```tsx
// Panel lateral deslizable (slide-in desde la derecha, 380px de ancho)
// o sección fija debajo de FormConclusion — decide según el diseño en disenos/eval/

// Props:
//   pacienteId: string  (para precargar datos antropométricos)
//   onEnviarAPrescripcion: (resultado: { kcal, pct, gramos }) => void
//   (al llamar esto, los valores se pre-rellenan en FormConclusion)

// Al montar: GET /api/pacientes/:id/antropometria/ultima
// GET /api/pacientes/:id (para edad y sexo del paciente)

// SECCIÓN A — TMB:
//   Campos auto-rellenados (read-only con badge "Auto-filled"):
//     Peso actual · Talla · Edad (calculada de fecha_nacimiento) · Sexo
//   Selector de fórmula (radio pills):
//     Mifflin-St Jeor (default) · Harris-Benedict · Katch-McArdle (solo si MLG disponible)
//   Chip resultado: "TMB: X kcal/día"

// SECCIÓN B — Gasto Total (TEE):
//   5 cards de nivel de actividad (FAF) con etiqueta + descripción corta
//   Muestra el FAF del historial clínico si existe (badge "From clinical history")
//   Resultado: "TEE: X kcal/día"
//   Campo personalizable "Meta calórica" (número, default = TEE)

// SECCIÓN C — Pesos de referencia:
//   "Peso ideal: X kg" · "Peso ajustado: Y kg" (o "—" si no aplica)

// SECCIÓN D — Distribución de macros:
//   Tres sliders vinculados (0-100%, suman siempre 100%):
//     Proteína % · CHO % · Grasa %
//   Al mover un slider: ajusta los otros dos proporcionalmente
//   Resultado en gramos: Prot Xg · CHO Xg · Grasa Xg
//   Presets rápidos (chips):
//     Alta proteína (30P/40C/30G) · Equilibrada (20P/50C/30G) ·
//     Baja en HC (30P/30C/40G) · Mediterránea (20P/45C/35G)

// SECCIÓN E — Intercambios ADA (acordeón colapsable):
//   Tabla resultado con intercambios calculados desde la meta calórica

// SECCIÓN F — Regla 7700 (acordeón colapsable):
//   Input "Déficit o superávit diario (kcal)" (número, puede ser negativo)
//   Resultado: "Pérdida/Ganancia estimada: X kg en Y días"
//              "≈ X.X kg por semana"

// SECCIÓN G — Conversores (acordeón colapsable):
//   Azúcar (g/día → cucharaditas · kcal · ¿excede OMS?)
//   Sodio (mg/día → g de sal · ¿excede OMS?)

// Botón "Send to prescription" (teal, bottom of panel):
//   Llama onEnviarAPrescripcion({ kcal: metaCalorica, pct: {prot,cho,grasa}, gramos })
//   Pre-rellena FormConclusion con estos valores
```

────────────────────────────────────────────────────────────
PASO 4 — FRONTEND: CONCLUSIONES (EVAL-05)
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/eval/FormConclusion.tsx

```tsx
// Props: pacienteId, consultaId, onGuardado?
// Al montar: GET /api/.../consultas/:cid/conclusion (precargar si existe)

// SECCIÓN 1 — Diagnóstico nutricional:
//   Combo-box "Diagnóstico principal" (tipeable + lista de diagnósticos frecuentes):
//     E40-E46 Desnutrición · E50-E64 Deficiencias de vitaminas/minerales ·
//     E65-E68 Obesidad y sobrepeso · Z72.4 Inactividad física · etc.
//   Al seleccionar: chip teal-50 con nombre + CIE-10 + × para quitar
//   Campo CIE-10 (editable manualmente si no viene de la lista)
//   Campo "Diagnóstico secundario" (text, opcional)
//   Textarea "Observaciones clínicas" (5 filas, libre)

// SECCIÓN 2 — Recomendaciones:
//   Chips predefinidos (click para agregar/quitar):
//     "Aumentar proteína" · "Hidratación: 2L/día" · "Reducir sodio" ·
//     "Alimentos ricos en hierro" · "Priorizar fibra" · "Reducir azúcares libres" ·
//     "+ Recomendación personalizada" (abre input inline)
//   Los chips seleccionados se muestran en una fila teal-50
//   Textarea "Recomendaciones adicionales" (3 filas)

// SECCIÓN 3 — Prescripción dietética:
//   Campo "Meta calórica (kcal/día)" (número) — pre-rellenable desde Calculadora
//   Tres campos numéricos enlazados (Proteína % / CHO % / Grasa %) — suman 100%
//   Gramos calculados auto: Prot Xg · CHO Xg · Grasa Xg (read-only, fondo gris)
//   Multi-select chips "Restricciones":
//     Sin gluten · Sin lactosa · Bajo sodio · Bajo en grasas · Diabética ·
//     Vegetariana · Vegana · Renal
//   Textarea "Suplementos y preparados" (libre)
//
//   Botón "Open calculator →" (teal outline) → abre PanelCalculadora
//   Cuando PanelCalculadora llama onEnviarAPrescripcion: los campos se pre-rellenan con animación

// SECCIÓN 4 — Acuerdos con el paciente:
//   Lista dinámica de checkboxes (texto editable + × para eliminar):
//     Botón "+ Add agreement" al final
//   3 ejemplos por defecto al crear por primera vez:
//     ☐ Registrar la ingesta diaria en la app
//     ☐ Realizar actividad física según lo prescrito
//     ☐ Tomar suplementos según indicación

// BARRA INFERIOR (sticky):
//   Texto muted izquierda: "Consulta #N · [fecha]"
//   Derecha: [Save draft] [Save and mark complete]
//     "Save and mark complete" → guarda + PUT /consultas/:cid/seccion { seccion:'conclusion', completa:true }
```

────────────────────────────────────────────────────────────
PASO 5 — FRONTEND: PLAN PRESCRITO (EVAL-07)
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/eval/ResumenPlanPrescrito.tsx

```tsx
// Props: pacienteId
// Al montar: GET /api/pacientes/:id/planes (filtrar plan con estado='activo')
// Solo muestra el resumen — NO permite editar (la edición es en la pestaña Plan del expediente)

// Si NO hay plan activo:
//   Empty state: icono de plato, texto "No active meal plan."
//   Botón "Create meal plan" → navega a /pacientes/:id/planes/nuevo

// Si hay plan activo:
//   Card: nombre del plan (bold) · chip "Active" (green) · "Edit full plan ↗" (link teal)
//   Barra de macros (horizontal, igual que en CLI): Prot 20% · CHO 50% · Grasa 30%
//   Grid semanal compacto (7 columnas × 5 filas):
//     Cada celda: icono de tipo de comida si hay comida, gris si vacío
//     Columnas: L M X J V S D
//     Filas: Desayuno · Media mañana · Almuerzo · Merienda · Cena
//   Total kcal del plan (si calculable desde el plan)

// Colocar este componente al fondo de FormConclusion, después de los acuerdos,
// o como sub-sección dentro de la pestaña Conclusions.
```

────────────────────────────────────────────────────────────
PASO 6 — INTEGRACIÓN EN ValoracionPaciente
────────────────────────────────────────────────────────────

Reemplaza el placeholder de 'conclusion' en ValoracionPaciente.tsx:

```tsx
{tabActiva === 'conclusion' && (
  <div className="space-y-8">
    <FormConclusion pacienteId={pacienteId} consultaId={consultaId} />
    <ResumenPlanPrescrito pacienteId={pacienteId} />
  </div>
)}
```

PanelCalculadora se abre dentro de FormConclusion al hacer click en "Open calculator →".
Implementa como un modal o como un panel overlay de 380px que aparece por encima del
formulario (posición fixed derecha) sin salir del contexto de la valoración.

────────────────────────────────────────────────────────────
PASO 7 — PRUEBAS.md — SECCIÓN R15
────────────────────────────────────────────────────────────

Agrega al final de docs/PRUEBAS.md:

```markdown
## R15 — Valoración ABCD: Conclusiones + Calculadora + Plan prescrito (EVAL-05, EVAL-06, EVAL-07)

### EVAL-05 · Conclusiones

- [ ] CA-15-01 PUT /conclusion guarda el diagnóstico con código CIE-10.
- [ ] CA-15-02 El UPSERT no duplica: guardar dos veces la misma consulta actualiza.
- [ ] CA-15-03 API calcula proteina_g/cho_g/grasa_g correctamente cuando vienen pct y kcal.
   Ejemplo: 2100 kcal, 20%P → 2100×0.20/4 = 105g.
- [ ] CA-15-04 Guardar conclusión marca sección 'conclusion' como completa.
- [ ] CA-15-05 Con 'antrop' y 'conclusion' completos, el botón "Finalize" se habilita.
- [ ] CA-15-06 Acuerdos se guardan correctamente como JSONB [{ texto, cumplido }].
- [ ] CA-15-07 Restricciones se almacenan como array JSONB.

### EVAL-06 · Calculadora nutricional

- [ ] CA-15-08 Mifflin-St Jeor: mujer 38 años, 78kg, 165cm → TMB ≈ 1548 kcal.
- [ ] CA-15-09 Harris-Benedict produce resultado diferente al de Mifflin para los mismos datos.
- [ ] CA-15-10 Katch-McArdle solo aparece habilitado si hay MLG disponible en antropometría.
- [ ] CA-15-11 Los sliders de % macro suman siempre 100 al mover cualquiera.
- [ ] CA-15-12 "Send to prescription" pre-rellena FormConclusion con kcal y porcentajes.
- [ ] CA-15-13 Regla 7700: déficit 500 kcal/día → aprox 15.4 días para perder 1 kg.
- [ ] CA-15-14 Conversor azúcar: 45g/día → 9 cucharaditas · excede OMS (>25g).
- [ ] CA-15-15 Conversor sodio: 2800 mg/día → 7g de sal · excede OMS (>2000mg).
- [ ] CA-15-16 Peso ajustado solo aparece cuando peso real > peso ideal + 20%.

### EVAL-07 · Plan prescrito

- [ ] CA-15-17 Si no hay plan activo: empty state con botón "Create meal plan".
- [ ] CA-15-18 Si hay plan activo: card muestra nombre, barra de macros y grid semanal.
- [ ] CA-15-19 "Edit full plan ↗" navega correctamente al plan en el expediente.
```

────────────────────────────────────────────────────────────
PASO 8 — COMMIT
────────────────────────────────────────────────────────────

  npm run lint --prefix apps/api
  npm run lint --prefix apps/web-professional
  npm run build --prefix apps/api

  git add apps/api/migrations/018_eval_conclusion.sql
  git add apps/api/src/routes/consultas.ts    # añadiste los endpoints de conclusion
  git add apps/web-professional/src/utils/calculadora.ts
  git add apps/web-professional/src/components/eval/FormConclusion.tsx
  git add apps/web-professional/src/components/eval/PanelCalculadora.tsx
  git add apps/web-professional/src/components/eval/ResumenPlanPrescrito.tsx
  git add apps/web-professional/src/pages/ValoracionPaciente.tsx
  git add docs/PRUEBAS.md

  git commit -m "R15: valoración ABCD — conclusiones, prescripción, calculadora nutricional y plan prescrito (EVAL-05, EVAL-06, EVAL-07)"

Reporta el hash del commit al finalizar.
