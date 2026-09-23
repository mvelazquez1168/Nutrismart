Lee docs/REBANADA-09.md para entender el contexto del proyecto. Esta es la
Rebanada 16: Consulta de seguimiento inteligente (EVAL-08).

A partir de la segunda cita, el sistema precarga todos los datos ABCD de la consulta
anterior y solo solicita los cambios. El profesional ve un comparativo delta (↑↓) por
cada indicador.

Requisito previo: R15 completada. Las tablas consulta, medicion_antropometrica,
historial_clinico, evaluacion_dietetica y conclusion_valoracion existen.
ValoracionPaciente funciona con los 5 tabs.

────────────────────────────────────────────────────────────
ANTES DE ESCRIBIR CUALQUIER CÓDIGO — leer estas referencias
────────────────────────────────────────────────────────────

1. Lee apps/api/src/routes/consultas.ts — la lógica de creación de consulta
   ya detecta tipo='seguimiento' si numero_consulta > 1. Verifica que funcione.
2. Lee apps/web-professional/src/pages/ValoracionPaciente.tsx — este componente
   ya existe. Vamos a agregar el modo seguimiento sin romper el modo inicial.
3. Lee apps/web-professional/src/components/eval/ — todos los Form* ya existen.
   El modo seguimiento los modifica para mostrar "anterior vs. actual".
4. No hay migración nueva en R16 — se usa el modelo de datos existente.
   Una consulta de seguimiento crea nuevas filas en las tablas de medición.
5. Revisa disenos/eval/ — diseños de BannerSeguimiento, VistaComparativa y
   DashboardDeltaConsultas.

────────────────────────────────────────────────────────────
PASO 1 — API: DATOS DE LA CONSULTA ANTERIOR
────────────────────────────────────────────────────────────

Agrega a apps/api/src/routes/consultas.ts:

```
GET  /api/pacientes/:pacienteId/consultas/ultima-finalizada
     — SELECT consulta WHERE clinica_id=$1 AND paciente_id=$2
         AND estado='finalizada'
         ORDER BY fecha_consulta DESC LIMIT 1
     — Si no existe → 404 (significa que es la primera consulta o no hay finalizadas)
     — Devuelve el snapshot completo con JOINs:

     {
       consulta: { id, tipo, numero_consulta, fecha_consulta },
       antropometria: { peso_kg, talla_cm, imc, pct_grasa, masa_libre_grasa_kg,
                        masa_muscular_kg, angulo_fase, cintura_cm, cadera_cm, icc },
       historial: { tipo_actividad, sesiones_semana, duracion_min, faf },
       dietetico:  { kcal_estimadas, proteina_g, cho_g, grasa_g, hidratacion_litros },
       conclusion: { diagnostico_principal, kcal_prescritas, pct_proteina, pct_cho,
                     pct_grasa, restricciones, acuerdos }
     }

     Implementación:
     1. SELECT la última consulta finalizada del paciente
     2. SELECT medicion_antropometrica WHERE consulta_id = consulta.id LIMIT 1
     3. SELECT historial_clinico WHERE clinica_id=$1 AND paciente_id=$2
        ORDER BY updated_at DESC LIMIT 1
        (historial es UPSERT — siempre un solo registro por paciente)
     4. SELECT evaluacion_dietetica WHERE consulta_id = consulta.id LIMIT 1
     5. SELECT conclusion_valoracion WHERE consulta_id = consulta.id LIMIT 1
     6. Devuelve el objeto compuesto


GET  /api/pacientes/:pacienteId/consultas/comparativa
     query: consultaActualId (UUID) — la consulta de seguimiento en curso
            consultaAnteriorId? (UUID, opcional — si no viene usa ultima-finalizada)
     — Devuelve:
       {
         anterior: { ...mismos campos de ultima-finalizada },
         actual:   { ...datos cargados hasta ahora en la consulta actual },
         deltas: {
           peso_kg:    { anterior, actual, delta, pct_cambio, tendencia: 'mejora'|'empeora'|'neutro' },
           imc:        { ... },
           pct_grasa:  { ... },
           angulo_fase:{ ... },
           kcal_estimadas: { ... },
           proteina_g: { ... },
         }
       }
     — Lógica de tendencia para cada indicador:
         peso_kg:    bajar = 'mejora' (si pct_grasa bajó también), si subió mujer embarazo = 'neutro'
                     → simplificar: 'mejora' si delta < 0, 'empeora' si delta > 0, 'neutro' si == 0
                     (el profesional interpreta el contexto clínico)
         pct_grasa:  bajar = 'mejora'
         masa_libre_grasa_kg: subir = 'mejora'
         angulo_fase: subir = 'mejora'
         kcal_estimadas: depende del objetivo → 'neutro' (no hay heurística simple)
         proteina_g: subir (si estaba bajo meta) = 'mejora' → 'neutro' también
```

────────────────────────────────────────────────────────────
PASO 2 — MODO SEGUIMIENTO EN ValoracionPaciente
────────────────────────────────────────────────────────────

Modifica apps/web-professional/src/pages/ValoracionPaciente.tsx.

Al montar la valoración, después de obtener la consulta:

```tsx
// Si consulta.tipo === 'seguimiento':
//   1. GET /api/pacientes/:id/consultas/ultima-finalizada → guardarlo en estado: datosAnteriores
//   2. Si 404 (no hay consulta previa finalizada): tratar como 'inicial' silenciosamente
//   3. Si éxito: activar modoSeguimiento = true, mostrar BannerSeguimiento

// Pasa modoSeguimiento y datosAnteriores a los hijos a través del ValoracionContext:
// ValoracionContext ahora incluye: consultaId, pacienteId, secciones_completas,
//   refrescarSecciones, modoSeguimiento: boolean, datosAnteriores: SnapshotConsulta | null
```

Modifica el HEADER de ValoracionPaciente cuando modoSeguimiento === true:
```tsx
// En lugar de "Initial assessment":
// "Follow-up · Consultation #N · [fecha]"
// Chip de estado: "Smart follow-up" (chip teal-100, texto teal-700, ícono ✨)
```

Crea apps/web-professional/src/components/eval/BannerSeguimiento.tsx:
```tsx
// Banner full-width teal-50 con borde teal-200, debajo del header:
// ✨ "Smart follow-up: Data from your last consultation (Jun 2, 2026) is preloaded.
//     Only update what changed."
// Link "View full baseline →" → abre modal con VistaComparativa
```

────────────────────────────────────────────────────────────
PASO 3 — TABS EN MODO SEGUIMIENTO
────────────────────────────────────────────────────────────

En TabsValoracion.tsx — cuando modoSeguimiento=true, cada tab muestra un chip de delta
en lugar del indicador de progreso simple:

```tsx
// Chip variants para cada tab:
//   Si hay datos actuales cargados y difieren de anterior: chip amber "Δ Updated"
//   Si no hay datos actuales aún: chip gray "Pending"
//   Si el profesional marcó como "sin cambios": chip green "No change"

// Para determinar si hay datos "actuales" en esta consulta:
//   Antrop:    hay medicion_antropometrica.consulta_id == consultaId
//   Bioquim:   hay labs cargados en los últimos 30 días (heurística)
//   Clínico:   historial.consulta_id == consultaId (fue editado en esta consulta)
//   Dietético: evaluacion_dietetica.consulta_id == consultaId
//   Conclusion:conclusion_valoracion.consulta_id == consultaId

// El tab activo sigue teniendo el subrayado teal normal
```

────────────────────────────────────────────────────────────
PASO 4 — FORMULARIOS EN MODO SEGUIMIENTO
────────────────────────────────────────────────────────────

**FormAntropometria.tsx** — modo seguimiento:

```tsx
// Si modoSeguimiento && datosAnteriores?.antropometria:
//   Mostrar layout de DOS COLUMNAS en lugar del layout simple:
//
//   COLUMNA IZQUIERDA "Previous (Jun 2, 2026)" — read-only:
//     Todos los campos con fondo gray-50, no editables
//     Valores de datosAnteriores.antropometria
//     Etiqueta de fecha de la consulta anterior
//
//   COLUMNA DERECHA "Today (Aug 14, 2026)" — editable:
//     Los mismos campos editables (FormAntropometria normal)
//     Pre-rellenados con los valores anteriores como punto de partida
//     Al cambiar cualquier valor: aparece chip delta junto al campo
//       ej: peso anterior 80.3 → actual 78.2 → chip "Δ −2.1 kg ↓" (green)
//
//   FILA DE DELTAS al fondo (solo cuando hay valores en ambas columnas):
//     Chips: "Weight −2.1 kg ↓" · "Body fat −3.2% ↓" · "Phase angle +0.4° ↑"
//     Cada chip: verde si es mejora, rojo si es empeora, gris si neutro
//     (usar la lógica de tendencia del API)
//
//   Botón adicional "No changes in anthropometry →" (gray outline):
//     Al click: copia los valores anteriores como la medición de hoy
//     (crea una medicion_antropometrica idéntica a la anterior, vinculada a la consulta actual)
```

**FormHistorialClinico.tsx** — modo seguimiento:

```tsx
// Si modoSeguimiento:
//   Los campos se pre-rellenan automáticamente con los datos del historial existente
//   (el historial ya es UPSERT — siempre hay un solo registro actualizable)
//   Agregar banner pequeño encima del formulario:
//     "Pre-loaded from previous consultation. Edit only what changed."
//   Tab en el sidebar: chip "No change" en verde para secciones sin modificar
//   Farmacología: lista pre-cargada de medicamentos activos (ya existe, no cambia el flujo)
```

**FormR24h.tsx y FormFrecuenciaConsumo.tsx** — modo seguimiento:

```tsx
// Si modoSeguimiento && datosAnteriores?.dietetico:
//   Banner sobre el timeline: "Pre-loaded from last consultation. Update if diet changed."
//   Pre-rellena recordatorio_24h y frecuencia_consumo con los datos anteriores
//   ResumenDietetico muestra comparativo "Previous: X kcal | Today: Y kcal | Δ Z"
```

**FormConclusion.tsx** — modo seguimiento:

```tsx
// Pre-rellena kcal_prescritas y distribución de macros desde la prescripción anterior
// (si el profesional no cambia nada, se guarda una nueva conclusión con los mismos valores)
// Banner: "Previous prescription: 2,100 kcal · 20P/50C/30G. Update if changed."
// Acuerdos: muestra los acuerdos anteriores con su estado (cumplido/no cumplido)
//   El profesional marca cuáles se cumplieron y agrega nuevos para esta consulta
```

────────────────────────────────────────────────────────────
PASO 5 — DASHBOARD DE COMPARATIVA (EVAL-08)
────────────────────────────────────────────────────────────

Crea apps/web-professional/src/components/eval/DashboardDeltaConsultas.tsx

```tsx
// Props: pacienteId, consultaId (la consulta actual de seguimiento)
// Al montar: GET /api/pacientes/:id/consultas/comparativa?consultaActualId=X

// Si no hay datos suficientes (no hay consulta anterior con datos):
//   Empty state "No comparison data available yet"

// Layout:
// ┌──────────────────────────────────────────────────────────┐
// │ "Progress since last consultation"                        │
// │ Jun 2 → Aug 14, 2026 (73 days)                          │
// ├──────────────┬──────────────┬──────────────┬────────────┤
// │ Weight       │ Body fat %   │ Phase angle  │ Agreements │
// │ 80.3 → 78.2  │ 31.6 → 28.4 │ 5.8 → 6.2°  │ 2/3 met    │
// │ −2.1 kg ↓   │ −3.2% ↓     │ +0.4° ↑     │ ○○●        │
// └──────────────┴──────────────┴──────────────┴────────────┘
//
// Cada KPI card (200px × 110px):
//   Label (muted, 12px) | Anterior (gray-400, pequeño, tachado)
//   Actual (24px bold, negro) | Chip delta (pill, color por tendencia)
//   Mini sparkline (3-6 puntos históricos si hay más consultas)
//
// Tabla comparativa debajo de los KPIs:
//   Columnas: Indicador | Anterior | Actual | Δ | Tendencia
//   Filas: todas las métricas disponibles
//   Chip de tendencia: ↑ verde / ↓ rojo / → gris
//
// Botón "Export comparison PDF" (gray outline) → llama al endpoint de PDF
//   si CLI-05 (R10) ya está implementado, usa esa ruta; si no, deshabilita con tooltip

// Colocar DashboardDeltaConsultas como primera sección visible cuando
// modoSeguimiento=true en ValoracionPaciente:
//   Mostrar ANTES de los tabs ABCD como un resumen rápido de progreso
```

────────────────────────────────────────────────────────────
PASO 6 — CONTEXTO: MODOSELECCION DE CONSULTA
────────────────────────────────────────────────────────────

En PacienteFicha.tsx — sección "Consultas":

```tsx
// Lista de consultas del paciente (ya existe desde R13):
// Ahora agregar: al hacer click en "Open" en una consulta borrador de seguimiento,
// navega a /pacientes/:id/valoracion/:consultaId → ValoracionPaciente detecta automáticamente
// el tipo y activa el modo seguimiento.

// El flujo de nueva consulta ya funciona:
// Botón "Nueva consulta" → POST /api/.../consultas → consulta.tipo detectado automáticamente
// Si es la primera: tipo='inicial' → modo normal
// Si ya hay una finalizada: tipo='seguimiento' → modo smart follow-up
```

────────────────────────────────────────────────────────────
PASO 7 — PRUEBAS.md — SECCIÓN R16
────────────────────────────────────────────────────────────

Agrega al final de docs/PRUEBAS.md:

```markdown
## R16 — Consulta de seguimiento inteligente (EVAL-08)

### Configuración del escenario de prueba
Tener un paciente con al menos una consulta inicial FINALIZADA con datos completos
en todas las secciones (antrop, bioquim, clinico, dietetico, conclusion).
Crear luego una nueva consulta para ese paciente → debe ser tipo='seguimiento'.

### Pruebas

- [ ] CA-16-01 POST /api/pacientes/:id/consultas para paciente con consulta finalizada
               → tipo='seguimiento' y numero_consulta > 1.
- [ ] CA-16-02 GET /ultima-finalizada devuelve el snapshot completo con datos ABCD de la
               última consulta finalizada.
- [ ] CA-16-03 GET /ultima-finalizada para paciente sin consultas finalizadas → 404.
- [ ] CA-16-04 ValoracionPaciente en modo seguimiento muestra BannerSeguimiento con la
               fecha de la consulta anterior.
- [ ] CA-16-05 Header de ValoracionPaciente muestra "Follow-up · Consultation #N".
- [ ] CA-16-06 FormAntropometria en modo seguimiento muestra las dos columnas
               (anterior read-only | actual editable) pre-rellenadas con datos previos.
- [ ] CA-16-07 Al cambiar el peso, aparece el chip delta con el valor correcto
               (ej: 80.3 → 78.2 = "Δ −2.1 kg").
- [ ] CA-16-08 Botón "No changes in anthropometry" crea una medición idéntica a la anterior
               vinculada a la consulta actual.
- [ ] CA-16-09 FormHistorialClinico muestra el banner "Pre-loaded" y los datos del historial.
- [ ] CA-16-10 FormConclusion pre-rellena la prescripción anterior y muestra el banner.
- [ ] CA-16-11 DashboardDeltaConsultas muestra los 4 KPI cards con valores correctos.
- [ ] CA-16-12 GET /comparativa calcula deltas correctamente (anterior - actual, con tendencia).
- [ ] CA-16-13 La comparativa no mezcla datos de distintas clínicas.
- [ ] CA-16-14 Una valoración de seguimiento se puede finalizar igual que una inicial.
- [ ] CA-16-15 Después de finalizar el seguimiento, una nueva consulta se crearía como
               Consulta #N+1 tipo='seguimiento'.
```

────────────────────────────────────────────────────────────
PASO 8 — COMMIT
────────────────────────────────────────────────────────────

  npm run lint --prefix apps/api
  npm run lint --prefix apps/web-professional
  npm run build --prefix apps/api

  git add apps/api/src/routes/consultas.ts    # nuevos endpoints ultima-finalizada y comparativa
  git add apps/web-professional/src/pages/ValoracionPaciente.tsx
  git add apps/web-professional/src/components/eval/BannerSeguimiento.tsx
  git add apps/web-professional/src/components/eval/DashboardDeltaConsultas.tsx
  git add apps/web-professional/src/components/eval/FormAntropometria.tsx  # modo seguimiento
  git add apps/web-professional/src/components/eval/FormHistorialClinico.tsx
  git add apps/web-professional/src/components/eval/FormR24h.tsx
  git add apps/web-professional/src/components/eval/FormConclusion.tsx
  git add docs/PRUEBAS.md

  git commit -m "R16: consulta de seguimiento inteligente con precarga ABCD y comparativa delta (EVAL-08)"

Reporta el hash del commit al finalizar.
