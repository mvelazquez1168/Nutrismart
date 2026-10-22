# R49 — Formulario de laboratorio dinámico + panel de analítica

## Contexto

El formulario de carga de laboratorio (`LaboratorioModal.tsx`) tiene un catálogo fijo de 14 analitos globales. No se pueden registrar analitos fuera de ese catálogo, no se soportan valores cualitativos (texto como "No Reactiva"), y la vista de resultados no muestra tendencias históricas por analito. Este prompt reemplaza toda esa lógica.

## Archivos relevantes ya relevados

- `apps/web-professional/src/components/LaboratorioModal.tsx` — modal de carga (459 líneas, se rediseña)
- `apps/web-professional/src/components/eval/PanelBioquimica.tsx` — panel que abre el modal y lista estudios (se amplía)
- `apps/api/src/routes/laboratorios.ts` — rutas de la API
- `apps/api/src/laboratorios/repositorio.ts` — queries SQL
- `apps/api/migrations/007_laboratorios.sql` — esquema original; tabla `biomarcador` con 14 entradas, `lab_resultado.valor` numeric NOT NULL

## Lo que NO entra en este prompt

- Pantalla de mantenimiento del catálogo (admin) → rebanada posterior
- Vista del paciente de sus propios laboratorios → no se toca
- Endpoint de anulación de estudio → no entra (las columnas ya existen en schema, se deja para después)
- Cambios en el parsing de PDF/CSV → no se tocan

---

## 1. Migración de base de datos

Crear `apps/api/migrations/0NN_lab_dinamico.sql` usando el siguiente número de migración disponible después del último archivo en `apps/api/migrations/`.

### 1.1 Ampliar tabla `biomarcador`

```sql
-- Agregar clinica_id (NULL = catálogo global, non-null = catálogo de clínica)
ALTER TABLE biomarcador
  ADD COLUMN clinica_id uuid REFERENCES clinica(id) ON DELETE CASCADE,
  ADD COLUMN es_cualitativo boolean NOT NULL DEFAULT false;

CREATE INDEX biomarcador_clinica_idx ON biomarcador(clinica_id) WHERE clinica_id IS NOT NULL;
```

### 1.2 Ampliar tabla `lab_resultado`

```sql
-- valor pasa a nullable; se agrega valor_texto para cualitativos
-- y nombre_libre para analitos ad hoc que no están en catálogo
ALTER TABLE lab_resultado
  ALTER COLUMN valor DROP NOT NULL,
  ADD COLUMN valor_texto text,
  ADD COLUMN nombre_libre text;

-- Al menos uno de valor o valor_texto debe estar presente
ALTER TABLE lab_resultado
  ADD CONSTRAINT lab_resultado_valor_check
  CHECK (valor IS NOT NULL OR valor_texto IS NOT NULL);

-- biomarcador_codigo puede ser NULL solo si hay nombre_libre
ALTER TABLE lab_resultado
  DROP CONSTRAINT IF EXISTS lab_resultado_biomarcador_codigo_fkey;

ALTER TABLE lab_resultado
  ADD CONSTRAINT lab_resultado_codigo_libre_check
  CHECK (biomarcador_codigo IS NOT NULL OR nombre_libre IS NOT NULL);

-- Restaurar FK con DEFERRABLE para que siga habiendo integridad cuando el código existe
ALTER TABLE lab_resultado
  ADD CONSTRAINT lab_resultado_biomarcador_fk
  FOREIGN KEY (biomarcador_codigo) REFERENCES biomarcador(codigo)
  ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
```

### 1.3 Expandir el catálogo global de biomarcadores

Insertar todos los analitos nuevos con `clinica_id = NULL` (globales). Mantener los 14 existentes tal como están; solo agregar los faltantes con `ON CONFLICT (codigo) DO NOTHING`.

Insertar los siguientes grupos y analitos (completar los valores de `orden`, `decimales`, `minimo`, `maximo` con los rangos clínicos estándar apropiados para cada uno; donde el rango varía por sexo se usan los valores femeninos como referencia general):

**Grupo: hematologia**
| codigo | nombre | unidad | es_cualitativo | decimales |
|--------|--------|--------|---------------|-----------|
| WBC | Leucocitos | x10³/μL | false | 1 |
| NEUT_PCT | Neutrófilos | % | false | 1 |
| LINF_PCT | Linfocitos | % | false | 1 |
| MONO_PCT | Monocitos | % | false | 1 |
| EOSI_PCT | Eosinófilos | % | false | 1 |
| BASO_PCT | Basófilos | % | false | 1 |
| PLT | Plaquetas | x10³/μL | false | 0 |
| VCM | Volumen Corpuscular Medio | fL | false | 1 |
| HCM | Hemoglobina Corpuscular Media | pg | false | 1 |
| CHCM | Conc. Hb Corpuscular Media | g/dL | false | 1 |
| ADE | Amplitud de Distribución Eritrocitaria | % | false | 1 |
| VSG | Velocidad de Sedimentación | mm/h | false | 0 |
| FERR | Ferritina | ng/mL | false | 1 |
| HIERRO | Hierro sérico | μg/dL | false | 0 |
| TIBC | Capacidad total de fijación de hierro | μg/dL | false | 0 |
| SATFE | Saturación de transferrina | % | false | 1 |
| B12 | Vitamina B12 | pg/mL | false | 0 |
| FOLATO | Ácido Fólico | ng/mL | false | 1 |
| RETIC | Reticulocitos | % | false | 2 |

**Grupo: perfil_lipidico** (ya tiene 4; agregar)
| codigo | nombre | unidad | es_cualitativo | decimales |
|--------|--------|--------|---------------|-----------|
| VLDL | VLDL | mg/dL | false | 0 |
| APOA1 | Apolipoproteína A1 | mg/dL | false | 0 |
| APOB | Apolipoproteína B | mg/dL | false | 0 |
| LPA | Lipoproteína (a) | mg/dL | false | 0 |

**Grupo: perfil_glucemico** (ya tiene glucosa e insulina; agregar)
| codigo | nombre | unidad | es_cualitativo | decimales |
|--------|--------|--------|---------------|-----------|
| PEPTC | Péptido C | ng/mL | false | 1 |
| GLU2H | Glucosa 2h postprandial | mg/dL | false | 0 |
| FRUCT | Fructosamina | μmol/L | false | 0 |
| HOMA | Índice HOMA-IR | — | false | 2 |

**Grupo: tiroides** (ya tiene TSH; agregar)
| codigo | nombre | unidad | es_cualitativo | decimales |
|--------|--------|--------|---------------|-----------|
| T3L | T3 libre | pg/mL | false | 2 |
| T4L | T4 libre | ng/dL | false | 2 |
| T3T | T3 total | ng/dL | false | 1 |
| T4T | T4 total | μg/dL | false | 1 |
| ANTITPO | Anti-TPO | UI/mL | false | 0 |
| ANTITIROG | Anti-Tiroglobulina | UI/mL | false | 0 |

**Grupo: funcion_hepatica** (ya tiene ALT y AST; agregar)
| codigo | nombre | unidad | es_cualitativo | decimales |
|--------|--------|--------|---------------|-----------|
| GGT | GGT (Gamma-glutamil transferasa) | U/L | false | 0 |
| FA | Fosfatasa Alcalina | U/L | false | 0 |
| BILI_T | Bilirrubina Total | mg/dL | false | 2 |
| BILI_D | Bilirrubina Directa | mg/dL | false | 2 |
| BILI_I | Bilirrubina Indirecta | mg/dL | false | 2 |
| ALB | Albúmina | g/dL | false | 1 |
| PT | Proteínas Totales | g/dL | false | 1 |
| LDH | Lactato Deshidrogenasa | U/L | false | 0 |

**Grupo: funcion_renal** (ya tiene creatinina; agregar)
| codigo | nombre | unidad | es_cualitativo | decimales |
|--------|--------|--------|---------------|-----------|
| BUN | BUN / Urea | mg/dL | false | 0 |
| AURICO | Ácido Úrico | mg/dL | false | 1 |
| TFG | TFG estimada (CKD-EPI) | mL/min/1.73m² | false | 0 |
| MICROALB | Microalbuminuria | mg/L | false | 1 |
| CISTC | Cistatina C | mg/L | false | 2 |

**Grupo: electrolitos** (grupo nuevo)
| codigo | nombre | unidad | es_cualitativo | decimales |
|--------|--------|--------|---------------|-----------|
| NA | Sodio | mEq/L | false | 0 |
| K | Potasio | mEq/L | false | 1 |
| CL | Cloro | mEq/L | false | 0 |
| CA | Calcio Total | mg/dL | false | 1 |
| CA_ION | Calcio Iónico | mmol/L | false | 2 |
| P | Fósforo | mg/dL | false | 1 |
| MG | Magnesio | mg/dL | false | 1 |
| CO3 | Bicarbonato | mEq/L | false | 0 |

**Grupo: vitaminas** (ya tiene vitamina D; agregar)
| codigo | nombre | unidad | es_cualitativo | decimales |
|--------|--------|--------|---------------|-----------|
| VITA | Vitamina A (Retinol) | μg/dL | false | 0 |
| VITE | Vitamina E (Alfa-tocoferol) | mg/L | false | 1 |
| ZINC | Zinc | μg/dL | false | 0 |
| SEL | Selenio | μg/L | false | 0 |
| CU | Cobre | μg/dL | false | 0 |

**Grupo: inflamacion** (grupo nuevo)
| codigo | nombre | unidad | es_cualitativo | decimales |
|--------|--------|--------|---------------|-----------|
| PCR | Proteína C Reactiva | mg/L | false | 1 |
| PCRHS | PCR Ultrasensible | mg/L | false | 2 |
| FIBRIN | Fibrinógeno | mg/dL | false | 0 |
| HOMOC | Homocisteína | μmol/L | false | 1 |
| IL6 | Interleucina-6 | pg/mL | false | 1 |

**Grupo: hormonas** (grupo nuevo)
| codigo | nombre | unidad | es_cualitativo | decimales |
|--------|--------|--------|---------------|-----------|
| CORT | Cortisol | μg/dL | false | 1 |
| DHEAS | DHEA-S | μg/dL | false | 0 |
| TEST | Testosterona Total | ng/dL | false | 0 |
| E2 | Estradiol | pg/mL | false | 0 |
| PROG | Progesterona | ng/mL | false | 2 |
| FSH | FSH | mUI/mL | false | 1 |
| LH | LH | mUI/mL | false | 1 |
| PRL | Prolactina | ng/mL | false | 1 |
| IGF1 | IGF-1 (Somatomedina C) | ng/mL | false | 0 |

**Grupo: inmunologia** (grupo nuevo, todos cualitativos)
| codigo | nombre | unidad | es_cualitativo | decimales |
|--------|--------|--------|---------------|-----------|
| VIH | VIH 1/2 | — | **true** | 0 |
| HBSAG | Hepatitis B (HBsAg) | — | **true** | 0 |
| ANTIHCV | Hepatitis C (Anti-HCV) | — | **true** | 0 |
| VDRL | VDRL / RPR (Sífilis) | — | **true** | 0 |
| HPYLORI | H. pylori IgG | — | **true** | 0 |
| TOXO_IGG | Toxoplasma IgG | — | **true** | 0 |
| CMV_IGG | CMV IgG | — | **true** | 0 |

Para los analitos cualitativos (`es_cualitativo = true`), la unidad es `—` y `decimales = 0`, `minimo` y `maximo` son NULL.

---

## 2. Cambios en la API

### 2.1 `GET /api/biomarcadores`

Que exista este endpoint en `apps/api/src/routes/laboratorios.ts`. Devuelve el catálogo disponible para la clínica del token: todos los globales (`clinica_id IS NULL`) más los propios de esa clínica, ordenados por `grupo`, luego por `orden`.

```typescript
// respuesta
[{
  codigo: string,
  nombre: string,
  grupo: string,
  unidad: string,
  es_cualitativo: boolean,
  decimales: number,
  minimo: number | null,
  maximo: number | null,
  activo: boolean
}]
```

Solo devuelve los que tienen `activo = true`.

### 2.2 `POST /api/pacientes/:id/laboratorios` — aceptar las nuevas estructuras

Que el body `resultados[]` acepte la nueva forma:

```typescript
{
  codigo?: string,        // si viene, debe existir en catálogo visible para el tenant
  nombre_libre?: string,  // requerido si codigo es null/undefined
  valor?: number,         // requerido si el analito es cuantitativo
  valor_texto?: string,   // requerido si el analito es cualitativo o no en catálogo
  refMinimo?: number,
  refMaximo?: number
}
```

Validaciones:
- `codigo` o `nombre_libre`, al menos uno presente.
- Si `codigo` presente: verificar que exista en el catálogo visible para el tenant (global + de la clínica del token).
- Si el biomarcador tiene `es_cualitativo = true`: requerir `valor_texto`, ignorar `valor`.
- Si el biomarcador es cuantitativo: requerir `valor` numérico finito.
- Si `nombre_libre` (sin `codigo`): requerir que venga al menos `valor` o `valor_texto`.
- `refMinimo`/`refMaximo` solo se guardan si el analito es cuantitativo.

En la inserción masiva en `lab_resultado`, guardar `biomarcador_codigo` (puede ser NULL), `nombre_libre` (puede ser NULL), `valor` (puede ser NULL), `valor_texto` (puede ser NULL).

### 2.3 `GET /api/pacientes/:id/laboratorios` — incluir los nuevos campos

Que cada `ResultadoLab` en la respuesta incluya `valor_texto` y `nombre_libre` además de los campos existentes.

### 2.4 `GET /api/pacientes/:id/analitica`

Nuevo endpoint. Devuelve la serie histórica de todos los analitos que tienen al menos un resultado **catalogado** (con `biomarcador_codigo IS NOT NULL`) para este paciente, solo estudios `estado = 'vigente'`.

```typescript
// respuesta
[{
  codigo: string,
  nombre: string,           // nombre del biomarcador del catálogo
  grupo: string,
  unidad: string,
  es_cualitativo: boolean,
  refMin: number | null,    // del rango efectivo (mismo algoritmo que GET estudios)
  refMax: number | null,
  serie: [{
    fecha: string,          // YYYY-MM-DD
    valor: number | null,
    valor_texto: string | null,
    estudio_id: string
  }]
}]
```

Ordenar la serie por `fecha ASC`. Solo incluir analitos con al menos 1 resultado. El rango de referencia se resuelve con el mismo algoritmo que ya existe (`SQL_RANGO_EFECTIVO_RESULTADO`).

---

## 3. Cambios en el frontend

### 3.1 Rediseño de `LaboratorioModal.tsx`

Reemplazar el paso 2 ("Revisión") por un formulario de filas dinámicas. El componente sigue teniendo dos pasos (`archivo` y `revision`), pero el paso 2 cambia completamente.

**Paso 2 — nueva UX:**

Al entrar al paso 2, la pantalla muestra:
- Campos de cabecera: `Fecha de muestra` (date, requerido) + `Laboratorio` (text, opcional) + `Notas` (textarea, opcional). Igual que antes.
- Una barra de búsqueda: input de texto con placeholder "Buscar analito (ej: Hemoglobina, Glucosa…)". Al escribir, filtra el catálogo en tiempo real (fetch a `GET /api/biomarcadores` al montar el componente, resultado en estado local).
- Debajo de la búsqueda, los resultados del filtro aparecen como chips/lista. Al hacer clic en un analito, se agrega como una fila.
- Las filas agregadas se muestran como una tabla compacta con columnas: **Analito** (nombre + código), **Valor** (input numérico o texto según `es_cualitativo`), **Unidad** (texto no editable), **Referencia** (texto no editable: min–max o "sin rango"), **Acción** (botón × para quitar la fila).
- Al final de la lista de filas, un enlace "＋ Agregar resultado no catalogado" abre una fila especial con campos: `Nombre del analito` (text) + `Valor` (text) + `Unidad` (text). Esta fila siempre guarda como `nombre_libre`.
- El botón de guardar valida que haya al menos una fila con valor ingresado (o archivoId). Si no hay ninguna fila con valor y no hay archivo, muestra error igual que antes.

Estado que maneja el componente:
```typescript
type FilaResultado = {
  id: string; // uuid local para key de React
  codigo: string | null;
  nombre: string; // del catálogo o libre
  es_cualitativo: boolean;
  valor: string; // siempre string en el input; se convierte al enviar
  unidad: string;
  refMin: number | null;
  refMax: number | null;
  esLibre: boolean;
};
```

Al guardar, construir el body para POST:
```typescript
resultados: filas
  .filter(f => f.valor.trim() !== '')
  .map(f => ({
    codigo: f.esLibre ? undefined : f.codigo,
    nombre_libre: f.esLibre ? f.nombre : undefined,
    valor: !f.es_cualitativo && !f.esLibre ? parseFloat(f.valor) : undefined,
    valor_texto: f.es_cualitativo || f.esLibre ? f.valor : undefined,
    refMinimo: f.refMin ?? undefined,
    refMaximo: f.refMax ?? undefined,
  }))
```

La lógica de archivo (paso 1) y la previsualización de PDF/CSV no cambian.

### 3.2 Nuevo panel de analítica en `PanelBioquimica.tsx`

Que `PanelBioquimica` tenga dos pestañas internas:
- **Estudios** — el contenido actual (lista de estudios con `ListaLaboratorios` y botón de nuevo estudio). No cambia nada.
- **Analítica** — nueva pestaña con el panel de tendencias.

**Panel Analítica:**

Al activarse la pestaña, hace fetch a `GET /api/pacientes/:pacienteId/analitica`. Mientras carga, muestra skeleton. Si no hay datos, muestra mensaje vacío.

Estructura visual (ver diseño de referencia: los mismos dos niveles que en el mockup):

**Capa 1 — tabla resumen:**
- Tabs horizontales por grupo: uno por cada `grupo` que tenga datos, más "Todos" al inicio.
- Bajo el tab activo: tabla con columnas `Analito | Último valor | Referencia | Estado | Variación | Tendencia | Fecha`.
  - `Estado`: badge NORMAL (verde) / ALTERADO (rojo) / SIN REF. (gris), calculado comparando el último valor contra `refMin`/`refMax`.
  - `Variación`: flecha + porcentaje respecto al penúltimo valor de la serie (si hay al menos 2 puntos). Color: rojo si el cambio agrava el estado alterado, verde si mejora, gris si sin relevancia.
  - `Tendencia`: sparkline SVG inline de todos los puntos de la serie (polilínea simple, 80×32px, color por estado actual).
  - Los analitos cualitativos muestran el último `valor_texto` en la columna "Último valor" sin badge de estado (el rango no aplica).
  - Analitos con `nombre_libre` (sin código) se excluyen de esta tabla — solo aparecen en la vista de cada estudio individual.
- Cada fila de la tabla es clickeable.

**Capa 2 — modal de tendencia (al hacer clic en una fila):**
- Modal o drawer lateral que muestra:
  - Nombre del analito + código + badge de estado.
  - Tres KPIs: último valor, rango de referencia, variación vs. anterior.
  - Gráfica de tendencia histórica. Usar la librería de gráficas que ya esté instalada en `apps/web-professional`; si no hay ninguna, instalar `recharts` (`npm install recharts` en `apps/web-professional`).
  - La gráfica es de tipo línea con los puntos coloreados según estado (rojo si alterado, verde si normal) y una banda sombreada que cubre el rango de referencia (refMin a refMax).
  - Para analitos cualitativos, en lugar de gráfica mostrar una línea de tiempo con chips que dicen el valor_texto de cada estudio y su fecha.
- El modal se cierra con Escape o clic fuera.

---

## 4. Verificación esperada

1. `GET /api/biomarcadores` devuelve al menos 70 analitos activos para cualquier tenant.
2. `POST /api/pacientes/:id/laboratorios` con un analito cualitativo (ej. VIH: "No Reactiva") retorna 201 y el resultado queda con `valor = NULL` y `valor_texto = 'No Reactiva'`.
3. `POST` con `nombre_libre = 'Inmunoglobulina IgG'` y `valor_texto = '1240'` retorna 201, `biomarcador_codigo = NULL`.
4. `GET /api/pacientes/:id/analitica` devuelve series históricas solo para los analitos catalogados que el paciente tiene.
5. El modal de nuevo estudio muestra el buscador de analitos; buscar "hem" filtra y muestra Hemoglobina, Hematocrito, etc.
6. Agregar 3 filas con valores y guardar crea el estudio con esos 3 resultados.
7. La pestaña Analítica del panel profesional muestra la tabla con los analitos del paciente; hacer clic abre la gráfica de tendencia.

---

## Notas de implementación

- El índice único actual en `lab_resultado` sobre `(estudio_id, biomarcador_codigo)` debe revisarse: con `biomarcador_codigo` nullable ya no sirve como estaba. Reemplazarlo por un índice único parcial `WHERE biomarcador_codigo IS NOT NULL` más una validación en la capa de aplicación para evitar duplicados en nombre_libre.
- La migración debe ser idempotente: usar `ADD COLUMN IF NOT EXISTS` donde aplique y `ON CONFLICT DO NOTHING` en los INSERT del catálogo.
- Los 14 analitos existentes no se modifican; el `INSERT ... ON CONFLICT DO NOTHING` los salta automáticamente.
- No tocar `PanelBioquimica` más allá de agregar las dos pestañas y el nuevo panel; la lógica del modal de nuevo estudio y la lista existente se conservan.
