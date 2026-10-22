# R50 — Panel de analítica de laboratorio

## Prerequisito

Este prompt requiere que R49 esté desplegado: necesita el endpoint `GET /api/pacientes/:id/analitica` y los campos `es_cualitativo`, `valor_texto`, `refMin`, `refMax` en la respuesta. No implementar R50 antes de R49.

## Contexto

Con R49 ya existe un catálogo amplio de analitos y el endpoint `/analitica` devuelve la serie histórica por analito para un paciente. Este prompt agrega el panel visual de esa información dentro de la app del profesional.

## Archivos que se tocan

- `apps/web-professional/src/components/eval/PanelBioquimica.tsx` — se agrega una pestaña nueva; el contenido existente no se toca
- `apps/web-professional/src/components/eval/PanelAnalitica.tsx` — componente nuevo (crear)
- `apps/web-professional/src/components/eval/TendenciaModal.tsx` — componente nuevo (crear)
- `apps/web-professional/package.json` — solo si no hay librería de gráficas instalada

## Lo que NO entra

- Ningún cambio en la API ni en migraciones
- No se modifica la pestaña "Estudios" de PanelBioquimica ni ninguna lógica existente
- No se toca la app del paciente

---

## 1. Librería de gráficas

Antes de implementar, verificar `apps/web-professional/package.json`. Si ya está instalada `recharts`, `chart.js`, `@nivo/line`, `victory` u otra librería de gráficas, usarla. Si no hay ninguna, instalar `recharts` con `npm install recharts` dentro de `apps/web-professional`.

---

## 2. Estructura de `PanelBioquimica.tsx`

Que `PanelBioquimica` tenga dos pestañas internas con el siguiente comportamiento:

```
[ Estudios ]  [ Analítica ]
```

- **Estudios**: todo lo que hoy existe en PanelBioquimica sin ningún cambio.
- **Analítica**: renderiza `<PanelAnalitica pacienteId={pacienteId} clinicaId={clinicaId} />`.

El tab activo por defecto es "Estudios". El estado de pestaña activa vive en PanelBioquimica (no en URL). Al cambiar de pestaña no se hace scroll ni se desmonta el contenido anterior.

---

## 3. Componente `PanelAnalitica`

### Props

```typescript
interface PanelAnaliticaProps {
  pacienteId: string;
  clinicaId: string; // para el header de autorización, igual que el resto de la app
}
```

### Fetch

Al montar, hace `GET /api/pacientes/:pacienteId/analitica`. Muestra skeleton de 3 filas mientras carga. Si la respuesta es un array vacío, muestra estado vacío: "Este paciente aún no tiene estudios registrados con analitos del catálogo."

### Tipo de dato recibido

```typescript
type AnalitoHistorico = {
  codigo: string;
  nombre: string;
  grupo: string;
  unidad: string;
  es_cualitativo: boolean;
  refMin: number | null;
  refMax: number | null;
  serie: {
    fecha: string;       // 'YYYY-MM-DD'
    valor: number | null;
    valor_texto: string | null;
    estudio_id: string;
  }[];
};
```

### Capa 1 — tabla resumen

**Tabs de grupos.** Calcular la lista de grupos únicos del resultado, en este orden de prioridad si existen:
`hematologia → perfil_lipidico → perfil_glucemico → tiroides → funcion_hepatica → funcion_renal → electrolitos → hormonas → vitaminas → inflamacion → inmunologia`
más cualquier otro grupo no listado al final. Añadir "Todos" como primera pestaña. El nombre visible de cada grupo se formatea con la función `formatGrupo` (mapear los códigos internos a nombres legibles: `hematologia → Hematología`, `perfil_lipidico → Perfil Lipídico`, `perfil_glucemico → Glucémico`, `tiroides → Tiroides`, `funcion_hepatica → Función Hepática`, `funcion_renal → Función Renal`, `electrolitos → Electrolitos`, `hormonas → Hormonas`, `vitaminas → Vitaminas`, `inflamacion → Inflamación`, `inmunologia → Inmunología`; cualquier otro grupo con primera letra en mayúscula).

**Tabla.** Para los analitos del grupo activo (todos si tab = "Todos"):

| Columna | Contenido |
|---------|-----------|
| **Analito** | nombre del analito; en tablet/móvil se omite el código |
| **Último valor** | para cuantitativos: `valor` formateado con sus decimales + unidad; para cualitativos: `valor_texto`; color rojo si alterado |
| **Referencia** | para cuantitativos: `refMin – refMax unidad`; si solo refMax: `≤ refMax`; si solo refMin: `≥ refMin`; si ninguno: `—`; para cualitativos: `—` |
| **Estado** | badge: `NORMAL` (verde) / `ALTERADO` (rojo) / `SIN REF.` (gris); cualitativos siempre `SIN REF.` |
| **Variación** | flecha + porcentaje vs. penúltimo valor de la serie; oculto si hay menos de 2 puntos o es cualitativo; color: rojo si el cambio agrava el estado fuera-de-rango, verde si mejora, gris si neutro |
| **Tendencia** | sparkline SVG inline (ver spec abajo) |
| **Fecha** | fecha del último punto de la serie, formato `DD mmm YYYY` |

Las columnas **Variación**, **Tendencia** y **Fecha** se ocultan en móvil (< 640px).

**Lógica de estado (calcularEstado):**
```typescript
function calcularEstado(a: AnalitoHistorico): 'ok' | 'bad' | 'none' {
  if (a.es_cualitativo) return 'none';
  const v = a.serie.at(-1)?.valor;
  if (v === null || v === undefined) return 'none';
  if (a.refMin !== null && v < a.refMin) return 'bad';
  if (a.refMax !== null && v > a.refMax) return 'bad';
  if (a.refMin === null && a.refMax === null) return 'none';
  return 'ok';
}
```

**Lógica de variación (calcularVariacion):**
```typescript
function calcularVariacion(a: AnalitoHistorico) {
  if (a.es_cualitativo || a.serie.length < 2) return null;
  const cur = a.serie.at(-1)!.valor;
  const prev = a.serie.at(-2)!.valor;
  if (cur === null || prev === null || prev === 0) return null;
  const diff = cur - prev;
  const pct = Math.abs(diff / prev * 100);
  const up = diff > 0;
  const estCur = calcularEstado(a);
  // ¿empeora? si está alterado Y el cambio lo aleja más del rango
  const empeora =
    estCur === 'bad' &&
    ((a.refMax !== null && up && cur > a.refMax) ||
     (a.refMin !== null && !up && cur < a.refMin));
  const mejora = estCur === 'ok' || (estCur === 'bad' && !empeora);
  return { pct: pct.toFixed(1), up, empeora, mejora: !empeora };
}
```

**Sparkline SVG.** Para cada analito cuantitativo generar un `<svg width="80" height="32">`:
- Escalar los valores de la serie al viewBox `[4, 4, 76, 28]` usando min/max de la serie ± 5% de margen.
- Dibujar una `<polyline>` con `stroke` verde si `estado = 'ok'`, rojo si `'bad'`, gris si `'none'`; `stroke-width="1.8"`, `fill="none"`.
- Dibujar un `<circle r="3">` en el último punto con el mismo color.
- Para analitos cualitativos, omitir el sparkline y dejar la celda vacía.

**Interacción.** Cada fila es clickeable. Al hacer clic abre `<TendenciaModal>` con el analito correspondiente. El cursor es `pointer`. Un hover suave sobre la fila (background levemente más claro).

**Alerta de analitos alterados.** Si hay al menos un analito con `estado = 'bad'`, mostrar un banner informativo encima de los tabs con el conteo: "N analito(s) fuera de rango en el último estudio". Click en el banner activa el tab "Todos" y hace scroll al primer analito alterado.

---

## 4. Componente `TendenciaModal`

### Props

```typescript
interface TendenciaModalProps {
  analito: AnalitoHistorico | null; // null = cerrado
  onClose: () => void;
}
```

### Estructura visual

Modal centrado en desktop, drawer desde abajo en móvil. Cierra con Escape y con clic en el backdrop.

**Cabecera:**
- Código del analito (pequeño, mayúsculas, color muted)
- Nombre completo del analito (título grande)
- Badge de estado

**KPIs (3 columnas):**
- **Último valor**: el valor numérico (o texto si cualitativo) + unidad debajo
- **Referencia**: el rango como texto + label "rango normal" / "valor máximo" / "valor mínimo" según corresponda; "—" si sin referencia
- **Vs. anterior**: flecha + porcentaje + dirección en texto ("Subió" / "Bajó" / "Sin cambio" / "—" si no aplica)

**Gráfica de tendencia — para analitos cuantitativos:**

Usar la librería instalada. La gráfica es de tipo línea con las siguientes características:
- Eje X: fechas de la serie (formato `MMM YY`)
- Eje Y: valor numérico; escala automática con un margen del 10% arriba y abajo del min/max
- Si hay `refMin` y/o `refMax`, pintar una banda horizontal sombreada entre refMin y refMax (o desde el 0 si solo refMax, o hasta el máximo visible si solo refMin), con opacidad baja (≈ 10–15%) en verde si el rango es amplio, sin color si no hay rango
- La línea principal: color verde si el último punto está en rango, rojo si alterado
- Cada punto: coloreado individualmente según si está dentro o fuera del rango en esa medición
- Tooltip al hover: fecha, valor + unidad, estado en esa medición
- Sin leyenda (es un solo analito)
- Altura: 200px fija

**Vista de línea de tiempo — para analitos cualitativos:**

En lugar de gráfica, mostrar los puntos de la serie como una lista vertical de chips con fecha + valor_texto. El chip más reciente va primero. Ejemplo:
```
● Oct 2026   No Reactiva
● Jul 2026   No Reactiva
● Ene 2026   No Reactiva
```

---

## 5. Estilos

Usar los tokens CSS y clases de la app profesional existente (variables de color, border-radius, shadows, fonts). No crear un sistema de diseño propio. Reutilizar los mismos badges, colores de estado (verde/rojo/gris) y tipografías que ya usa el resto de la pantalla de evaluación.

---

## 6. Verificación esperada

1. La pestaña "Analítica" aparece junto a "Estudios" en el panel de laboratorio del paciente.
2. Con un paciente que tiene 3 estudios registrados con al menos Hemoglobina, Glucosa y Colesterol: la tabla muestra los 3 analitos con sus valores, estados, sparklines y variación correcta.
3. Un analito con `es_cualitativo = true` (ej. VIH) muestra su `valor_texto` en la columna "Último valor", badge "SIN REF." y sin sparkline.
4. Al hacer clic en Hemoglobina se abre el modal con la gráfica mostrando la serie histórica y la banda de referencia sombreada.
5. El banner de alertas aparece y muestra el número correcto de analitos alterados.
6. En pantalla de 375px los tabs se pueden desplazar horizontalmente, la tabla muestra solo 4 columnas (analito, último valor, referencia, estado) y el modal ocupa el 100% del ancho desde la parte inferior.
7. Cerrar el modal con Escape y con clic en el backdrop funciona.
