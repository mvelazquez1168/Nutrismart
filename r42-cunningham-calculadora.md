# r42 — Calculadora: ecuación de Cunningham + GEE múltiple + Disponibilidad Energética

## Contexto

Monorepo NutriSmart en `c:\nutrismart`. El componente a modificar es la calculadora nutricional del profesional. Lee el código actual antes de editar. La calculadora ya tiene: captura de datos antropométricos (peso, talla, % grasa, MLG), fórmula Katch-McArdle, FAF, cálculo de GET, e intercambios ADA. Todo lo que hay en la calculadora que NO se menciona en este prompt se conserva sin cambios.

---

## Cambio 1 — Agregar método "Cunningham" al selector de fórmula

La calculadora ya tiene un selector para elegir la fórmula de GER (actualmente solo Katch-McArdle u otras). Agrega **Ecuación de Cunningham** como opción.

Cuando el usuario selecciona Cunningham:
- La fórmula activa cambia a: `GER = 500 + (22 × MLG_kg)`
- El selector de FAF (Factor de Actividad Física) se **oculta completamente** — no se usa con este método.
- Aparece la sección de GEE descrita en el Cambio 2.

Cuando el usuario selecciona cualquier otra fórmula (Harris-Benedict, Katch-McArdle, Mifflin, etc.):
- El FAF vuelve a mostrarse normalmente.
- La sección de GEE se oculta.
- El flujo actual no cambia.

### Cálculo GER Cunningham

```typescript
function calcularGERCunningham(mlg_kg: number): number {
  return 500 + (22 * mlg_kg)
}
```

MLG viene del campo ya existente en la calculadora (`mlg_kg` o calculado como `peso * (1 - pct_grasa/100)`). Si MLG no está disponible, mostrar mensaje de error inline: _"Se requiere la masa libre de grasa (MLG). Ingresa el peso y % de grasa corporal."_

---

## Cambio 2 — Sección de GEE (Gasto Energético por Ejercicio) — visible solo con Cunningham

Debajo del resultado de GER, agregar una sección titulada **"Gasto Energético por Ejercicio (GEE)"**.

### Estructura de una entrada GEE

```typescript
interface EntradaGEE {
  id: string             // uuid generado en cliente
  actividad: string      // seleccionada del catálogo o escrita libre
  mets: number           // del catálogo o ingresado manualmente
  kg: number             // peso corporal; pre-llenar con peso_actual del paciente
  minutos: number        // duración del ejercicio
  gee: number            // calculado: 0.0175 × kg × minutos × mets
}
```

### Catálogo de actividades con METS

Implementa un `Select` (shadcn) con estas opciones. Al seleccionar una actividad, el campo METS se pre-llena con el valor del catálogo pero sigue siendo editable:

```typescript
export const CATALOGO_ACTIVIDADES = [
  { label: 'Caminar liviano (< 4 km/h)',         mets: 2.5 },
  { label: 'Caminar moderado (4–6 km/h)',         mets: 3.5 },
  { label: 'Caminar rápido (> 6 km/h)',           mets: 4.5 },
  { label: 'Trotar / jogging',                    mets: 7.0 },
  { label: 'Correr (ritmo moderado)',              mets: 9.0 },
  { label: 'Correr (ritmo intenso)',               mets: 11.5 },
  { label: 'Ciclismo recreativo',                 mets: 4.0 },
  { label: 'Ciclismo moderado',                   mets: 8.0 },
  { label: 'Natación recreativa',                 mets: 6.0 },
  { label: 'Natación competitiva',                mets: 10.0 },
  { label: 'Aeróbicos / baile aeróbico',          mets: 6.5 },
  { label: 'Yoga',                                mets: 3.0 },
  { label: 'Pilates',                             mets: 3.5 },
  { label: 'Pesas / entrenamiento de fuerza',     mets: 5.0 },
  { label: 'HIIT / entrenamiento funcional',      mets: 8.5 },
  { label: 'Fútbol',                              mets: 7.0 },
  { label: 'Baloncesto',                          mets: 6.5 },
  { label: 'Tenis',                               mets: 7.0 },
  { label: 'Actividad libre (ingresar METS)',     mets: 0   },
] as const
```

### UI de la sección GEE

Mostrar una tabla/lista dinámica. Cada fila tiene:

| Actividad (Select) | METS (número, editable) | Peso (kg) | Minutos | GEE calculado |
|---|---|---|---|---|

- Botón **"+ Agregar actividad"** para añadir una fila nueva.
- Cada fila tiene un botón de eliminar (ícono ✕).
- El GEE de cada fila se calcula en tiempo real: `gee = 0.0175 × kg × minutos × mets`
- Al fondo de la sección: **GEE Total = suma de todos los GEE**

### Fórmula GEE

```typescript
function calcularGEE(kg: number, minutos: number, mets: number): number {
  return 0.0175 * kg * minutos * mets
}
```

---

## Cambio 3 — Cálculo de GET con Cunningham

Cuando el método activo es Cunningham:

```
GET = (GER × 1.1) + GEE_total
```

- `GER × 1.1` representa el efecto termogénico de los alimentos (TEF ≈ 10%).
- `GEE_total` = suma de todas las entradas de GEE.
- Mostrar el GET resultante con el mismo estilo visual que ya tiene la calculadora para el resultado final.

---

## Cambio 4 — Disponibilidad Energética (DE) con interpretación

Inmediatamente después de mostrar el GET sugerido, agregar un bloque de **"Disponibilidad Energética"**.

### Fórmula

```typescript
function calcularDisponibilidadEnergetica(
  get: number,
  gee_total: number,
  mlg_kg: number
): number {
  return (get - gee_total) / mlg_kg
  // Equivale a (GER × 1.1) / MLG_kg
}
```

Resultado en **kcal / kg MLG / día**.

### Interpretación

```typescript
function interpretarDE(de: number): { nivel: string; color: string; descripcion: string } {
  if (de < 30) return {
    nivel: 'Deficiencia energética severa',
    color: 'destructive',   // rojo en shadcn
    descripcion: 'Riesgo de Deficiencia Energética Relativa en el Deporte (RED-S). Revisar ingesta calórica urgentemente.'
  }
  if (de < 45) return {
    nivel: 'Deficiencia energética leve / moderada',
    color: 'warning',       // amarillo/naranja — usar clase de alerta o badge amarillo
    descripcion: 'Por debajo de la disponibilidad óptima. Monitorear signos de fatiga, hormonal y óseos.'
  }
  if (de <= 60) return {
    nivel: 'Disponibilidad energética óptima',
    color: 'success',       // verde — badge verde o texto en color primario
    descripcion: 'Rango recomendado (45–60 kcal/kg MLG/día). Adecuado para sostener funciones fisiológicas y rendimiento.'
  }
  return {
    nivel: 'Excedente energético',
    color: 'secondary',     // neutro/azul
    descripcion: 'Por encima de 60 kcal/kg MLG/día. Considerar si el objetivo clínico lo justifica.'
  }
}
```

### UI del bloque DE

Mostrar como un card o alerta con:
- Valor numérico grande: `XX.X kcal/kg MLG/día`
- Badge o chip con el nivel (color según interpretación)
- Texto de descripción en tamaño pequeño

Si MLG no está disponible o GEE total es 0, calcular igual pero mostrar una nota: _"GEE = 0. Agrega actividades para un cálculo más preciso."_

---

## Cambio 5 — Persistencia de las entradas GEE

Las entradas GEE se guardan **por consulta** (punto de control). Persisten junto con los demás datos de la calculadora en la columna `datos_calculadora` JSONB del punto de control activo.

Agrega al schema de `datos_calculadora` los campos:

```typescript
{
  // ... campos existentes ...
  metodo_ger: 'katch_mcardle' | 'cunningham' | 'harris_benedict' | string,
  gee_entradas: EntradaGEE[],   // array de actividades del día
  gee_total: number,
  get_cunningham: number | null,
  disponibilidad_energetica: number | null,
}
```

Si `datos_calculadora` ya tiene un schema Zod en la API, actualízalo con estos campos (todos opcionales/nullable para no romper registros existentes).

---

## Verificación final

Después de los cambios, verificar en el navegador:

1. Al seleccionar "Ecuación de Cunningham" en el selector de fórmula:
   - El FAF desaparece.
   - Aparece la sección GEE.
   - GER muestra el valor correcto: `500 + 22 × MLG`.

2. Al agregar actividades en GEE:
   - El selector muestra el catálogo de actividades.
   - El METS se pre-llena al seleccionar una actividad y es editable.
   - El GEE de cada fila se recalcula en tiempo real.
   - El GEE Total se actualiza al agregar/eliminar filas.

3. El GET se calcula correctamente: `(GER × 1.1) + GEE_total`.

4. El bloque de Disponibilidad Energética muestra el valor y la interpretación con el color correcto según el rango.

5. Al cambiar a otra fórmula (ej. Katch-McArdle), la sección GEE desaparece y el FAF reaparece.

6. Los datos persisten al guardar la calculadora y se recuperan al volver a abrirla en la misma consulta.
