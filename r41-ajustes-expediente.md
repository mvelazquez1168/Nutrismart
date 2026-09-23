# r41 — Ajustes al expediente clínico (7 cambios)

## Contexto

Monorepo NutriSmart en `c:\nutrismart`. API Fastify en `apps/api` (puerto 4001 en Docker, 4000 internamente). Frontend profesional en `apps/web-professional` (React + TypeScript + Vite + Tailwind + shadcn/Radix). Multitenant con `clinica_id`. Siempre leer el código antes de editar.

Este prompt contiene **7 cambios independientes**. Ejecútalos en el orden listado para mantener coherencia. Cada sección indica qué archivos tocar.

---

## Cambio 1 — Clínico / Hábitos: reestructurar campos

### Qué hacer

**Eliminar** de la sección Hábitos los campos:
- Nivel de actividad física
- Fuma actualmente
- Consumo de alcohol

**Conservar:**
- Hora de sueño

**Agregar** tres campos nuevos:

| Campo | Tipo | Notas de implementación |
|---|---|---|
| Calificación de descanso | Entero 1–10 | Usar un componente `Slider` (shadcn/Radix) con valor mínimo 1 y máximo 10. Mostrar el valor seleccionado junto al slider. Añadir debajo de él este texto de ayuda: _"1 = descanso muy malo · 10 = descanso excelente"_ |
| Veces que despierta durante la noche | Entero ≥ 0 | Input numérico, mínimo 0 |
| Notas de hábitos | Texto libre | Textarea, sin límite rígido |

### Migración de base de datos

Localiza la tabla que almacena los datos de hábitos (probablemente `medicion_clinica`, `habitos_paciente` o un JSONB en `punto_control`). Inspecciona el schema antes de escribir la migración.

Si los campos están en columnas individuales, la migración debe:
```sql
-- Ajustar según la tabla real que encuentres
ALTER TABLE <tabla_habitos>
  DROP COLUMN IF EXISTS nivel_actividad_fisica,
  DROP COLUMN IF EXISTS fuma_actualmente,
  DROP COLUMN IF EXISTS consumo_alcohol,
  ADD COLUMN IF NOT EXISTS calificacion_descanso SMALLINT CHECK (calificacion_descanso BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS veces_despierta_noche SMALLINT CHECK (veces_despierta_noche >= 0),
  ADD COLUMN IF NOT EXISTS notas_habitos TEXT;
```

Si los campos están en un JSONB, actualiza el schema de validación Zod en la API y elimina/agrega las claves correspondientes en el tipo TypeScript. No borres datos existentes de JSONB con un `UPDATE` masivo; los nuevos campos simplemente no estarán presentes en registros viejos y el front debe tratarlos como `null`/vacío.

### En el frontend

- Localiza el componente de la sección Hábitos.
- Elimina los controles de los tres campos removidos.
- Agrega los tres controles nuevos en el mismo lugar.
- El `Slider` de calificación de descanso: importar de `@/components/ui/slider` (shadcn). Si no existe, instalarlo con `npx shadcn@latest add slider`.

---

## Cambio 2 — Eliminar sección "Notas" y agregar nota del médico al final de la página

### Qué hacer

1. **Eliminar** la carpeta / tab / sección actual llamada "Notas" del expediente del paciente.
2. **Agregar al final de la página del expediente** (fuera de las tabs, debajo de todas ellas) una sección llamada **"Notas del profesional"** con las siguientes características:
   - Textarea editable, guardado automático o con botón "Guardar nota".
   - Solo visible/editable por el profesional (no por el paciente).
   - Persistida en base de datos por paciente (una nota global por paciente, no por consulta).

### Migración de base de datos

Si la tabla `paciente` no tiene columna de notas del profesional:
```sql
ALTER TABLE paciente
  ADD COLUMN IF NOT EXISTS nota_profesional TEXT;
```

Si ya existe una tabla separada de notas, reutilizarla y adaptar el endpoint.

### API

- `GET /pacientes/:id` — incluir `nota_profesional` en la respuesta si no está ya.
- `PATCH /pacientes/:id/nota` — body: `{ nota_profesional: string }`. Solo actualiza ese campo. Validar que el profesional pertenece a la misma clínica del paciente.

### Frontend

- Quitar la tab/carpeta de Notas del componente de navegación del expediente.
- Al final del componente de página del expediente, agregar la sección "Notas del profesional" con el textarea y el botón guardar (o auto-save con debounce de 1 s).

---

## Cambio 3 — Corregir botón "Abrir / crear plan alimentario" en Conclusiones

### Síntoma

En `Resumen → Nueva consulta → Conclusiones` hay un botón para abrir o crear el plan alimentario, pero al hacer click no ocurre nada (o lanza error).

### Qué hacer

1. Localizar el componente de Conclusiones y el handler del botón.
2. Identificar el bug: puede ser una ruta de navegación incorrecta, un `planId` nulo que no se maneja, un endpoint que falla silenciosamente, o un `onClick` vacío.
3. Corregir el bug. El comportamiento esperado:
   - Si el paciente ya tiene un plan alimentario vigente → navegar a la vista de ese plan en modo edición.
   - Si no tiene plan → crear uno nuevo (POST al endpoint de planes) y navegar al nuevo plan.
4. Agregar manejo de error visible al usuario (toast o mensaje inline) si el POST falla.

No re-escribas el flujo completo; solo corrige lo que está roto. Si el endpoint de planes no existe aún, anota ese caso y crea uno mínimo funcional (`POST /pacientes/:id/planes-alimentarios`) que retorne el plan recién creado con su `id`.

---

## Cambio 4 — Renombrar "Plan Alimentario" y mostrar lista histórica

### Qué hacer

1. **Renombrar** la tab/carpeta del expediente: de "Plan Alimentario" → **"Histórico de Planes Alimentarios"**.
2. El contenido de esa sección debe mostrar una **lista** de todos los planes alimentarios prescritos para el paciente, ordenados del más reciente al más antiguo.
3. Cada ítem de la lista debe mostrar como mínimo: fecha de prescripción y nombre/título del plan (si existe).
4. Al hacer click en cualquier ítem de la lista → abrir ese plan en **modo consulta (solo lectura)**.

### API

- `GET /pacientes/:id/planes-alimentarios` — retornar array de planes `{ id, titulo, fecha_prescripcion, ... }` ordenados por `fecha_prescripcion DESC`.
- `GET /pacientes/:id/planes-alimentarios/:planId` — retornar el plan completo para visualización.

Si estos endpoints ya existen, reutilizarlos. Si no, crearlos.

### Frontend

- Reemplazar el contenido actual de la tab de Plan Alimentario por el componente de lista.
- El componente de vista en modo solo lectura puede ser el mismo que el de edición con `readOnly={true}` o un componente dedicado; elige lo que tenga menos superficie de cambio.

---

## Cambio 5 — Dietético / Recordatorio 24h: cálculo automático por fila con listas ADA

### Qué hacer

Cuando el usuario ingresa **alimento + cantidad + unidad** en el Recordatorio 24h, el sistema debe calcular automáticamente los gramos de carbohidrato, proteína, grasas y el total de kcal para esa fila, usando las listas de intercambio de la American Diabetes Association (ADA).

El valor calculado de **kcal es editable** (el profesional puede corregirlo manualmente).

### Lógica de cálculo

Implementa una función `calcularMacrosADA(alimento: string, cantidad: number, unidad: string)` en un módulo utilitario del frontend (`src/lib/ada-intercambios.ts`).

#### Tabla de macros por grupo ADA (valores por 1 intercambio / porción estándar)

```typescript
export const GRUPOS_ADA = [
  // grupo, kcal, cho_g, prot_g, grasas_g, porcionEstandar (en la unidad más común)
  { grupo: 'almidones',         kcal: 80,  cho: 15, prot: 3,  grasas: 1,  porcion: '1/2 taza o 30g' },
  { grupo: 'frutas',            kcal: 60,  cho: 15, prot: 0,  grasas: 0,  porcion: '1 porción mediana' },
  { grupo: 'leche_descremada',  kcal: 90,  cho: 12, prot: 8,  grasas: 0,  porcion: '240 ml' },
  { grupo: 'leche_semidesc',    kcal: 120, cho: 12, prot: 8,  grasas: 5,  porcion: '240 ml' },
  { grupo: 'leche_entera',      kcal: 150, cho: 12, prot: 8,  grasas: 8,  porcion: '240 ml' },
  { grupo: 'verduras',          kcal: 25,  cho: 5,  prot: 2,  grasas: 0,  porcion: '1/2 taza cocida' },
  { grupo: 'carne_muy_magra',   kcal: 35,  cho: 0,  prot: 7,  grasas: 1,  porcion: '30g' },
  { grupo: 'carne_magra',       kcal: 55,  cho: 0,  prot: 7,  grasas: 3,  porcion: '30g' },
  { grupo: 'carne_semigorda',   kcal: 75,  cho: 0,  prot: 7,  grasas: 5,  porcion: '30g' },
  { grupo: 'carne_gorda',       kcal: 100, cho: 0,  prot: 7,  grasas: 8,  porcion: '30g' },
  { grupo: 'grasas',            kcal: 45,  cho: 0,  prot: 0,  grasas: 5,  porcion: '1 cdta' },
  { grupo: 'carbohidratos_libres', kcal: 0, cho: 0, prot: 0, grasas: 0,  porcion: '-' },
] as const
```

#### Diccionario de alimentos → grupo ADA

Incluye al menos los alimentos más comunes en la región latinoamericana. Usa este diccionario como punto de partida y permite extensión futura:

```typescript
export const ALIMENTOS_ADA: Record<string, keyof typeof GRUPOS_ADA[number]['grupo']> = {
  // Almidones
  'arroz': 'almidones', 'arroz cocido': 'almidones',
  'pan blanco': 'almidones', 'pan integral': 'almidones', 'tortilla': 'almidones',
  'papa': 'almidones', 'papa cocida': 'almidones', 'yuca': 'almidones',
  'frijoles': 'almidones', 'lentejas': 'almidones', 'maíz': 'almidones',
  'avena': 'almidones', 'cereal': 'almidones', 'pasta': 'almidones', 'plátano maduro': 'almidones',
  // Frutas
  'manzana': 'frutas', 'banano': 'frutas', 'naranja': 'frutas', 'papaya': 'frutas',
  'melón': 'frutas', 'sandía': 'frutas', 'mango': 'frutas', 'piña': 'frutas',
  'fresa': 'frutas', 'uva': 'frutas', 'pera': 'frutas',
  // Lácteos
  'leche descremada': 'leche_descremada', 'leche entera': 'leche_entera',
  'yogur descremado': 'leche_descremada', 'yogur': 'leche_semidesc',
  // Verduras
  'brócoli': 'verduras', 'zanahoria': 'verduras', 'lechuga': 'verduras',
  'tomate': 'verduras', 'pepino': 'verduras', 'espinaca': 'verduras',
  'chayote': 'verduras', 'vainica': 'verduras', 'repollo': 'verduras',
  // Carnes
  'pollo': 'carne_magra', 'pechuga de pollo': 'carne_muy_magra',
  'carne de res': 'carne_semigorda', 'atún en agua': 'carne_muy_magra',
  'pescado': 'carne_magra', 'huevo': 'carne_semigorda', 'clara de huevo': 'carne_muy_magra',
  'cerdo': 'carne_semigorda', 'jamón': 'carne_magra', 'queso': 'carne_semigorda',
  // Grasas
  'aceite': 'grasas', 'mantequilla': 'grasas', 'margarina': 'grasas',
  'aguacate': 'grasas', 'mayonesa': 'grasas', 'nuez': 'grasas',
  // Libre
  'agua': 'carbohidratos_libres', 'café': 'carbohidratos_libres', 'té': 'carbohidratos_libres',
}
```

#### Algoritmo de cálculo

```typescript
export function calcularMacrosADA(
  alimento: string,
  cantidad: number,
  unidad: string
): { cho_g: number; prot_g: number; grasas_g: number; kcal: number } | null {
  // Normalizar nombre del alimento (minúsculas, sin acentos, trim)
  const clave = normalizar(alimento)
  const grupo = ALIMENTOS_ADA[clave]
  if (!grupo) return null  // alimento no reconocido → devuelve null, no bloquea

  const macros = GRUPOS_ADA.find(g => g.grupo === grupo)!

  // Convertir cantidad a número de intercambios según la unidad
  // Regla simplificada: 1 porción estándar = 1 intercambio
  // Para 'g': usar la porción en gramos del grupo (almidones=30g, carnes=30g, etc.)
  const intercambios = calcularIntercambios(cantidad, unidad, grupo)

  return {
    cho_g:   +(macros.cho   * intercambios).toFixed(1),
    prot_g:  +(macros.prot  * intercambios).toFixed(1),
    grasas_g: +(macros.grasas * intercambios).toFixed(1),
    kcal:    +(macros.kcal  * intercambios).toFixed(0),
  }
}

function calcularIntercambios(cantidad: number, unidad: string, grupo: string): number {
  const u = unidad.toLowerCase().trim()
  // Gramos: usar tabla de gramos por intercambio por grupo
  const grPorIntercambio: Record<string, number> = {
    almidones: 30, frutas: 120, leche_descremada: 240, leche_semidesc: 240,
    leche_entera: 240, verduras: 80, carne_muy_magra: 30, carne_magra: 30,
    carne_semigorda: 30, carne_gorda: 30, grasas: 5,
  }
  if (u === 'g' || u === 'gr' || u === 'gramos') {
    return cantidad / (grPorIntercambio[grupo] ?? 30)
  }
  if (u === 'ml' || u === 'cc') {
    return cantidad / 240  // para lácteos principalmente
  }
  if (u === 'taza' || u === 'tazas') return cantidad
  if (u === 'cdta' || u === 'cucharadita') return cantidad
  if (u === 'cda' || u === 'cucharada') return cantidad * 3  // 1 cda ≈ 3 cdtas de grasa
  if (u === 'unidad' || u === 'pza' || u === 'pieza') return cantidad
  if (u === 'porción' || u === 'porcion') return cantidad
  // Fallback: tratar cantidad como número de intercambios
  return cantidad
}
```

Si el alimento no está en el diccionario, los campos de macros quedan vacíos (no se bloquea la captura). El profesional puede llenarlos manualmente.

### Estructura de datos de la fila

Agrega al tipo de fila del Recordatorio 24h los siguientes campos calculados:

```typescript
interface FilaRecordatorio {
  id: string
  tiempo_comida: string
  hora: string
  alimento: string
  cantidad: number | null
  unidad: string
  // Campos calculados (pueden ser null si alimento no está en diccionario)
  cho_g: number | null
  prot_g: number | null
  grasas_g: number | null
  kcal: number | null         // editable por el profesional
  kcal_manual: boolean        // true si el profesional editó el kcal
}
```

Persiste estos campos junto con el resto de la fila en la columna JSONB `filas` de `registro_dietetico` (o la tabla que ya exista para el recordatorio).

### UI de la fila

Cada fila de la tabla del Recordatorio 24h debe mostrar, después de la columna de unidad:

| CHO (g) | Prot (g) | Grasas (g) | kcal |
|---------|---------|-----------|------|
| auto    | auto    | auto       | auto / editable |

- Los campos CHO, Prot y Grasas son de solo lectura (calculados automáticamente).
- El campo kcal es un input numérico editable. Al editarlo manualmente, setear `kcal_manual = true`. Si el usuario borra el valor, volver al calculado.
- Cuando cambia el alimento, cantidad o unidad → recalcular inmediatamente.

### Resumen y Macros

Al final de la sección Dietético (o en la carpeta "Resumen y Macros"), agregar una fila de totales que sume los valores de todas las filas del Recordatorio 24h:

```
Total CHO: XX g  |  Total Proteína: XX g  |  Total Grasas: XX g  |  Total kcal: XXXX
```

Si esos totales ya aparecen ahí, actualizar su fuente de datos para usar los valores calculados de las filas.

---

## Cambio 6 — Renombrar "Recordatorio 24h" → "Recordatorio 24h / Consumo Usual"

Solo cambiar la etiqueta visible en la tab/carpeta. No cambiar nombres de variables, endpoints ni columnas de base de datos para no romper nada.

Buscar el string `"Recordatorio 24h"` en los archivos del frontend y reemplazarlo por `"Recordatorio 24h / Consumo Usual"` únicamente donde aparezca como etiqueta visible al usuario (atributo `label`, contenido de texto en JSX, etc.).

---

## Cambio 7 — Antropometría / Medidas básicas: cambiar label "pierna" → "Circunferencia de pantorrilla"

Buscar en el componente de Medidas Básicas (dentro de Antropometría) el label o placeholder que dice "pierna" y cambiarlo por **"Circunferencia de pantorrilla"**. Solo el texto visible; no cambiar el nombre de la columna en base de datos ni el nombre de la variable.

---

## Migración y numeración

Usa el siguiente número de migración consecutivo al último que exista en `apps/api/migrations/`. Verifica cuál es con:
```
ls apps/api/migrations/ | sort | tail -5
```

Si hay varias migraciones nuevas en este PR (Cambio 1 y Cambio 2), crea archivos separados con números consecutivos.

---

## Verificación final

Después de todos los cambios, verificar:

1. `apps/api` compila sin errores TypeScript.
2. `apps/web-professional` compila sin errores TypeScript.
3. En el navegador:
   - Clínico/Hábitos: muestra hora de sueño + los 3 campos nuevos; los 3 eliminados no aparecen.
   - No hay tab de "Notas". Abajo del expediente aparece "Notas del profesional" con textarea guardable.
   - Botón de plan alimentario en Conclusiones navega o crea el plan correctamente.
   - Tab dice "Histórico de Planes Alimentarios" y muestra lista; click abre en solo lectura.
   - En Recordatorio 24h / Consumo Usual: al ingresar un alimento conocido, los macros se calculan automáticamente; kcal es editable.
   - Totales de macros aparecen en Resumen y Macros.
   - Antropometría muestra "Circunferencia de pantorrilla" (no "pierna").
