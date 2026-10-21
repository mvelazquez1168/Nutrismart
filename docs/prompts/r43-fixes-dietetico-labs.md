# R43 — Fixes: Consumo Usual (intercambios ADA) + Laboratorios (lectura PDF, modal, ordenamiento)

Crea la rama `r43-fixes-dietetico-laboratorios` desde `main` y aplica los siguientes cambios.

---

## Bloque 1 — Consumo Usual: análisis ADA solo sobre alimentos entre `()` y reporte de sin equivalencia

### Archivo: `apps/api/src/routes/registroDietetico.ts`

**Cambio 1 — `SISTEMA_ADA`**

Reemplazar la constante `SISTEMA_ADA` por completo con:

```
Eres un asistente de nutrición clínica. Tu tarea es analizar los alimentos entre paréntesis () en el texto de un tiempo de comida y estimar su composición nutricional usando las tablas de intercambio del Sistema ADA.

Valores nutricionales por intercambio ADA:
| Grupo | CHO (g) | Prot (g) | Grasas (g) | kcal |
|---|---|---|---|---|
| Leche descremada | 12 | 8 | 1 | 100 |
| Leche semidescremada | 12 | 8 | 5 | 120 |
| Leche entera | 12 | 8 | 8 | 160 |
| Vegetales | 5 | 2 | 0 | 25 |
| Frutas | 15 | 0 | 0 | 60 |
| Azúcares | 5 | 0 | 0 | 20 |
| Cereales | 15 | 3 | 1 | 80 |
| Carnes magras | 0 | 7 | 2 | 45 |
| Carnes semimagras | 0 | 7 | 5 | 75 |
| Carnes alta grasa | 0 | 7 | 8 | 100 |
| Grasas | 0 | 0 | 5 | 45 |

Instrucciones:
1. SOLO analiza los alimentos que aparezcan ENTRE PARÉNTESIS () en el texto. Ignora completamente todo lo que esté fuera de los paréntesis.
2. Para cada alimento entre paréntesis, asígnalo al grupo de intercambio ADA más apropiado.
3. Si un alimento entre paréntesis no tiene equivalencia clara en la lista ADA (alimentos regionales, preparaciones muy específicas, etc.), inclúyelo en el array "sin_equivalencia" en lugar de estimarlo.
4. Estima la cantidad de intercambios según las porciones mencionadas (o porciones estándar si no se especifican cantidades).
5. Multiplica intercambios × valores del grupo para obtener kcal, CHO, Prot y Grasas de cada alimento clasificado.
6. Suma todos los alimentos clasificables para dar el total.
7. Responde ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown.

Formato de respuesta JSON:
{ "kcal": 0.0, "cho_g": 0.0, "prot_g": 0.0, "grasas_g": 0.0, "sin_equivalencia": [] }
```

**Cambio 2 — `parsearJson`**

La función hoy extrae `kcal`, `cho_g`, `prot_g`, `grasas_g`. Extenderla para que también extraiga `sin_equivalencia: string[]`. Si el campo no existe o no es un array de strings, devolver `[]`. Actualizar el tipo de retorno para incluirlo.

**Cambio 3 — endpoint `POST /analizar-ia`**

Actualizar el tipo local de `parsed` para incluir `sin_equivalencia: string[]`.

En el `return` final, reemplazar `reply.send(respuesta(actualizado))` por:
```typescript
return reply.send({ ...respuesta(actualizado), _sinEquivalencia: parsed.sin_equivalencia })
```

---

### Archivo: `apps/web-professional/src/api/registroDietetico.ts`

**Cambio 4 — tipo `RegistroDietetico`**

Agregar al interface:
```typescript
/** Solo presente en respuesta de analizar-ia. No se persiste en BD. */
_sinEquivalencia?: string[]
```

---

### Archivo: `apps/web-professional/src/components/eval/TablaDietetica.tsx`

**Cambio 5 — estado `sinEquivalencia`**

```typescript
const [sinEquivalencia, setSinEquivalencia] = useState<Record<string, string[]>>({})
```

**Cambio 6 — función `analizar(i)` — leer resultado**

Después de `hidratar(r)`:
```typescript
setSinEquivalencia((prev) => {
  if (r._sinEquivalencia && r._sinEquivalencia.length > 0) {
    return { ...prev, [fila.tiempo_comida]: r._sinEquivalencia }
  }
  const copia = { ...prev }
  delete copia[fila.tiempo_comida]
  return copia
})
```

**Cambio 7 — UI: label informativo en la parte superior del componente**

El componente tiene un encabezado con `<h3>` (título) y un `<p>` (subtítulo). Debajo de ese encabezado, y SOLO cuando el `tipo` es `consumo_usual`, agregar un banner informativo con color de alerta suave:

```tsx
{tipo === 'consumo_usual' && (
  <div className="rounded-md border border-[color:var(--status-alert)] bg-surface-2 px-4 py-2 text-sm text-ink">
    <span className="font-semibold text-[color:var(--status-alert)]">ⓘ </span>
    Solo se consideran para la búsqueda de equivalencias en la lista de intercambios los alimentos que escribas{' '}
    <strong className="font-semibold">entre paréntesis ( )</strong>.
    El resto del texto se ignora en el análisis ADA.
  </div>
)}
```

**Cambio 9 — UI: mostrar alimentos sin equivalencia**

Después del bloque de badges `{analizado && (<>...</>)}`:
```tsx
{(sinEquivalencia[f.tiempo_comida] ?? []).length > 0 && (
  <p className="mt-1 text-xs text-[color:var(--status-alert)]">
    Sin equivalencia ADA:{' '}
    <span className="font-medium">
      {sinEquivalencia[f.tiempo_comida].join(', ')}
    </span>
  </p>
)}
```

---

## Bloque 2 — Laboratorios: lectura automática de PDF, modal persistente y ordenamiento

### Problema raíz

Cuando el profesional sube un PDF de laboratorio, el sistema lo sube al servidor pero **no extrae los valores** — el modal abre el paso de revisión con todos los campos vacíos. El profesional no lo sabe y guarda el estudio sin valores. Eso causa los tres mensajes que aparecen en el expediente:

- *"Sin valores capturados; solo el informe adjunto."* → el estudio tiene archivo pero cero resultados guardados.
- *"Sin referencia"* → sin valores no hay nada contra qué comparar.
- *"Todavía no hay una interpretación de este estudio."* → sin valores la IA no puede interpretar.

La solución son tres partes: (A) extraer valores del PDF con IA, (B) hacer el modal verdaderamente modal para que un click accidental no borre el trabajo, y (C) verificar el ordenamiento.

---

### Parte A — Extracción de valores de PDF con IA

#### Archivo: `apps/api/src/routes/archivos.ts` (o donde esté el router de `/api/archivos`)

Agregar un nuevo endpoint `POST /api/archivos/:archivoId/previsualizar-pdf` que:

1. Lea el archivo subido (el PDF ya está en el servidor, busca cómo se accede al buffer/path del archivo con el `archivoId` dado — revisa el repositorio de archivos).
2. Extraiga el texto del PDF usando la librería `pdf-parse` (instalar si no está: `npm install pdf-parse` en `apps/api` y `npm install --save-dev @types/pdf-parse`).
3. Si la extracción de texto da menos de 50 caracteres (PDF escaneado sin texto seleccionable), devolver `{ reconocidos: [], noReconocidos: [], avisos: ["Este PDF no contiene texto seleccionable. Captura los valores manualmente."] }` sin llamar a la IA.
4. Si hay texto suficiente, obtener el catálogo completo de biomarcadores (reutiliza la función que ya existe para obtenerlos) y llamar a la IA (con `llamarClaude` ya existente) con el siguiente prompt de sistema:

```
Eres un asistente de nutrición clínica. Se te da el texto extraído de un informe de laboratorio y un catálogo de biomarcadores.
Tu tarea es identificar los valores de laboratorio presentes en el texto y mapearlos al código correcto del catálogo.

Catálogo de biomarcadores (código → nombre):
[INSERTAR AQUÍ LISTA DE BIOMARCADORES EN FORMATO: codigo: nombre, uno por línea]

Instrucciones:
1. Identifica cada analito en el texto del informe junto con su valor numérico.
2. Mapea cada analito al código del catálogo que mejor corresponda.
3. Si un analito del informe no corresponde a ningún código del catálogo, inclúyelo en "no_reconocidos".
4. Devuelve ÚNICAMENTE JSON válido, sin texto adicional, sin markdown.

Formato:
{
  "reconocidos": [{ "codigo": "GLU", "valor": 95.0 }],
  "no_reconocidos": [{ "etiqueta": "Ferritina", "valor": "45.2" }]
}
```

El prompt de usuario debe ser: `Texto del informe:\n\n{texto extraído del PDF}`

5. Parsear la respuesta JSON de la IA. Si falla el parseo, devolver `{ reconocidos: [], noReconocidos: [], avisos: ["No se pudo interpretar el informe automáticamente. Captura los valores manualmente."] }`.
6. Devolver `{ reconocidos, noReconocidos, avisos }` con la misma forma que ya devuelve `previsualizar-csv`.

**Nota de implementación**: El consumo de IA de este endpoint debe registrarse con `funcion: 'lectura_pdf_lab'` igual que otros endpoints que usan `llamarClaude`.

---

#### Archivo: `apps/web-professional/src/api/laboratorios.ts`

Agregar función:
```typescript
export function previsualizarPdf(archivoId: string): Promise<PreviewCsv> {
  return apiPost<PreviewCsv>(`/api/archivos/${archivoId}/previsualizar-pdf`, {})
}
```

Usar el mismo tipo `PreviewCsv` que ya existe para el CSV (tiene `reconocidos`, `noReconocidos`, `avisos`). Si el tipo no existe como exportación nombrada, créalo o reutiliza el inferido.

---

#### Archivo: `apps/web-professional/src/components/LaboratorioModal.tsx`

En la función `procesarArchivo(f)`, el bloque `else` (que hoy hace `setValores({})` cuando el archivo no es CSV) debe cambiarse para que también intente la lectura por IA cuando el archivo es PDF:

```typescript
if (subido.mime === 'text/csv') {
  const prev = await previsualizarCsv(subido.id)
  // ... código existente ...
} else if (subido.mime === 'application/pdf') {
  // Intentar extracción IA del PDF
  const prev = await previsualizarPdf(subido.id)
  const iniciales: Record<string, string> = {}
  for (const r of prev.reconocidos) iniciales[r.codigo] = String(r.valor)
  setValores(iniciales)
  setNoReconocidos(prev.noReconocidos)
  setAvisos(
    prev.reconocidos.length > 0
      ? [`Se encontraron ${prev.reconocidos.length} valores en el PDF. Revisa y corrige si es necesario.`, ...prev.avisos]
      : prev.avisos
  )
} else {
  // Imagen u otro formato: captura manual
  setValores({})
  setNoReconocidos([])
  setAvisos(['Este archivo es una imagen. Captura los valores manualmente en los campos de abajo.'])
}
```

En el paso de revisión, cuando `avisos` tiene mensajes, ya se muestran en la UI existente (el bloque `{avisos.length > 0 && ...}`). No hace falta agregar UI nueva.

---

### Parte B — Modal persistente (no cierra al click fuera)

#### Archivo: `apps/web-professional/src/components/Modal.tsx`

Agregar al interface `Props`:
```typescript
/** Cuando true, clicar en el fondo NO cierra el modal. */
sinCierreAlFondo?: boolean
```

Agregar al destructuring con valor por defecto `false`.

Modificar el `onMouseDown` del fondo:
```typescript
onMouseDown={(e) => {
  if (e.target === e.currentTarget && !bloqueado && !sinCierreAlFondo) onCerrar()
}}
```

#### Archivo: `apps/web-professional/src/components/LaboratorioModal.tsx`

En `<Modal ...>`, agregar la prop `sinCierreAlFondo`.

---

### Parte C — Ordenamiento por fecha de estudio

#### Archivo: `apps/api/src/laboratorios/repositorio.ts`

La consulta que lista los estudios ya tiene `ORDER BY e.fecha DESC, e.created_at DESC`, donde `e.fecha` es la fecha de la muestra ingresada por el profesional. Verificar que en el INSERT de `crearEstudio` la columna `fecha` se guarda con el valor que llega en el body (no con `NOW()` ni `CURRENT_DATE`). Si ya es así, no hay bug — el ordenamiento es correcto.

---

## Commit final

```
git add apps/api/src/routes/registroDietetico.ts \
        apps/api/src/routes/archivos.ts \
        apps/web-professional/src/api/registroDietetico.ts \
        apps/web-professional/src/api/laboratorios.ts \
        apps/web-professional/src/components/eval/TablaDietetica.tsx \
        apps/web-professional/src/components/Modal.tsx \
        apps/web-professional/src/components/LaboratorioModal.tsx

git commit -m "feat(r43): intercambios ADA solo en (), sin equivalencia; lectura PDF laboratorios con IA; modal persistente"

git push origin r43-fixes-dietetico-laboratorios
```
