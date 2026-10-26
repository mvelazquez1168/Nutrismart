# R52 — Ingesta Diaria estilo Macros app

**Rama base:** `main` (incluye R51 — commit merge `2b24149`)  
**Rama nueva:** `r52-ingesta-diaria`  
**Objetivo:** módulo de registro de alimentos por comida/día con seguimiento de macros, siguiendo el patrón UX de la app Macros – Calorie Counter. Reemplaza el PanelDiario existente ("Qué comí") en web-patient.

---

## ⚠️ Pre-vuelo: checksum migración 022

Antes de cualquier deploy a producción, conectarse a la DB de prod y verificar:

```sql
-- Servidor (SSH) — dentro del contenedor nutrismart-db o via psql
SELECT version, checksum FROM schema_migrations WHERE version = '022';
```

- **`40240bc03d9eadce`** → prod tiene LF, OK, continuar.
- **`f6f75020b430f0df`** → prod tiene CRLF registrado; corregir la fila antes de `deploy.sh` y luego continuar:
  ```sql
  UPDATE schema_migrations SET checksum = '40240bc03d9eadce' WHERE version = '022';
  ```
  El archivo en disco no cambia (ya es LF en el repo), solo se corrige el hash almacenado.

Si el contenedor de producción no está corriendo al momento de verificar, dejar esta verificación como paso obligatorio antes de ejecutar `deploy.sh` en el servidor.

---

## Paso 0 — Rama

```bash
# PowerShell (local Windows)
git checkout main
git pull
git checkout -b r52-ingesta-diaria
```

---

## Paso 1 — Migración 056: tablas de alimentos e ingesta

Crear `apps/api/migrations/056_alimentos_ingesta.sql` con encoding ASCII (sin BOM):

```sql
-- 056_alimentos_ingesta.sql

-- Catálogo de alimentos
CREATE TABLE IF NOT EXISTS alimento (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              TEXT NOT NULL,
  categoria           TEXT,
  calorias_100g       NUMERIC(8,2),
  carbohidratos_100g  NUMERIC(8,2),
  proteina_100g       NUMERIC(8,2),
  grasa_100g          NUMERIC(8,2),
  fibra_100g          NUMERIC(8,2),
  fuente              TEXT NOT NULL DEFAULT 'manual',
  codigo_barras       TEXT,
  verificado          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS alimento_nombre_idx ON alimento USING gin(to_tsvector('spanish', nombre));
CREATE INDEX IF NOT EXISTS alimento_barras_idx ON alimento (codigo_barras) WHERE codigo_barras IS NOT NULL;

-- Unidades de medida por alimento
CREATE TABLE IF NOT EXISTS alimento_unidad (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alimento_id         UUID NOT NULL REFERENCES alimento(id) ON DELETE CASCADE,
  nombre              TEXT NOT NULL,
  gramos_equivalentes NUMERIC(8,2) NOT NULL,
  es_defecto          BOOLEAN NOT NULL DEFAULT FALSE
);

-- Metas de macros por paciente (puestas por el nutricionista)
CREATE TABLE IF NOT EXISTS plan_nutricional (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id           UUID NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  fecha_inicio          DATE NOT NULL,
  fecha_fin             DATE,
  meta_calorias         INT,
  meta_carbohidratos_g  INT,
  meta_proteina_g       INT,
  meta_grasa_g          INT,
  meta_agua_ml          INT,
  notas                 TEXT,
  created_by            UUID REFERENCES profesional(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plan_nutricional_paciente_idx ON plan_nutricional (paciente_id, fecha_inicio DESC);

-- Diario de ingesta
CREATE TABLE IF NOT EXISTS ingesta_diaria (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id     UUID NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  fecha           DATE NOT NULL,
  tipo_comida     TEXT NOT NULL CHECK (tipo_comida IN ('desayuno','almuerzo','cena','merienda','otro')),
  alimento_id     UUID REFERENCES alimento(id),
  nombre_libre    TEXT,
  cantidad        NUMERIC(8,2) NOT NULL DEFAULT 1,
  unidad_id       UUID REFERENCES alimento_unidad(id),
  gramos_total    NUMERIC(8,2),
  calorias        NUMERIC(8,2),
  carbohidratos_g NUMERIC(8,2),
  proteina_g      NUMERIC(8,2),
  grasa_g         NUMERIC(8,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ingesta_paciente_fecha_idx ON ingesta_diaria (paciente_id, fecha DESC);
```

Guardar con `Set-Content -Encoding ASCII` desde PowerShell (igual que 055).

---

## Paso 2 — Migración 057: seed alimentos CR/LatAm

Crear `apps/api/migrations/057_seed_alimentos.sql` con encoding ASCII.

El seed debe incluir al menos los siguientes alimentos con sus valores por 100g y sus unidades de medida típicas en Costa Rica. Buscar los valores nutricionales en USDA FoodData Central (fddc.nal.usda.gov) o fuente equivalente verificada:

| Nombre | Categoría |
|--------|-----------|
| Arroz blanco cocido | Cereales |
| Arroz integral cocido | Cereales |
| Frijoles negros cocidos | Legumbres |
| Frijoles rojos cocidos | Legumbres |
| Gallo pinto (casero) | Platos CR |
| Tortilla de maíz | Panadería |
| Pan de molde blanco | Panadería |
| Papa cocida | Tubérculos |
| Yuca cocida | Tubérculos |
| Plátano maduro | Frutas |
| Plátano verde cocido | Tubérculos |
| Banano | Frutas |
| Manzana | Frutas |
| Papaya | Frutas |
| Piña | Frutas |
| Pechuga de pollo asada | Carnes |
| Carne molida res 90% | Carnes |
| Tilapia al vapor | Pescados |
| Atún en agua (enlatado) | Pescados |
| Huevo entero cocido | Huevos |
| Queso turrialba | Lácteos |
| Leche entera | Lácteos |
| Leche descremada | Lácteos |
| Yogur natural | Lácteos |
| Aguacate | Grasas |
| Aceite vegetal | Grasas |
| Lechuga | Verduras |
| Tomate | Verduras |
| Chayote cocido | Verduras |
| Zanahoria cocida | Verduras |
| Brócoli cocido | Verduras |
| Agua de coco (pipa) | Bebidas |

Para cada alimento incluir al menos 2 unidades (la de 100g siempre, más la porción típica costarricense). Marcar `es_defecto=true` en la porción típica.

Ejemplo de estructura del INSERT:
```sql
WITH a AS (
  INSERT INTO alimento (nombre, categoria, calorias_100g, carbohidratos_100g,
    proteina_100g, grasa_100g, fibra_100g, fuente, verificado)
  VALUES ('Arroz Blanco Cocido','Cereales', 130, 28.2, 2.7, 0.3, 0.4, 'usda', true)
  RETURNING id
)
INSERT INTO alimento_unidad (alimento_id, nombre, gramos_equivalentes, es_defecto)
SELECT id, '100g', 100, false FROM a
UNION ALL
SELECT id, '1 taza (170g)', 170, true FROM a
UNION ALL
SELECT id, '1 plato (250g)', 250, false FROM a;
```

---

## Paso 3 — Backend: endpoints de alimentos e ingesta

En `apps/api/src/routes/`, que existan los siguientes endpoints nuevos (si ya hay un archivo de rutas apropiado, agregar allí; si no, crear `alimentos.routes.ts` e `ingesta.routes.ts`):

### Endpoints de alimentos (públicos para paciente autenticado)

```
GET  /api/alimentos
     ?q=<texto>          búsqueda full-text (si q está vacío devuelve los primeros 30)
     &fuente=biblioteca  filtra por fuente!=paciente
     &fuente=mis-alimentos filtra por alimento.fuente = paciente_id del JWT
     &limit=20
     → Array<{ id, nombre, categoria, calorias_100g, carbohidratos_100g,
                proteina_100g, grasa_100g, fibra_100g, verificado,
                unidades: [{ id, nombre, gramos_equivalentes, es_defecto }] }>

GET  /api/alimentos/:id
     → mismo shape, con todas sus unidades
```

### Endpoints de plan nutricional

```
GET  /api/pacientes/:pacienteId/plan-nutricional/vigente
     → { id, meta_calorias, meta_carbohidratos_g, meta_proteina_g,
          meta_grasa_g, meta_agua_ml, fecha_inicio, fecha_fin }
     (el vigente es el que tiene fecha_inicio <= hoy y
      (fecha_fin IS NULL OR fecha_fin >= hoy), ORDER BY fecha_inicio DESC LIMIT 1)
     Si no hay plan → 404

POST /api/pacientes/:pacienteId/plan-nutricional
     Body: { fecha_inicio, fecha_fin?, meta_calorias, meta_carbohidratos_g,
              meta_proteina_g, meta_grasa_g, meta_agua_ml?, notas? }
     Solo accesible para el profesional tratante (verificar relación)
     → 201 con el plan creado
```

### Endpoints de ingesta

```
GET  /api/pacientes/:pacienteId/ingesta?fecha=YYYY-MM-DD
     → Array<{ id, tipo_comida, alimento_id, nombre (del alimento o nombre_libre),
                cantidad, unidad_nombre, gramos_total,
                calorias, carbohidratos_g, proteina_g, grasa_g }>
     Ordenado por tipo_comida (desayuno→almuerzo→cena→merienda→otro), luego created_at

POST /api/pacientes/:pacienteId/ingesta
     Body: { fecha, tipo_comida, alimento_id, cantidad, unidad_id }
     El backend calcula gramos_total, calorias, carbohidratos_g, proteina_g, grasa_g
     usando alimento.xxx_100g * (alimento_unidad.gramos_equivalentes/100) * cantidad
     → 201 con el item creado (mismo shape que GET)

DELETE /api/pacientes/:pacienteId/ingesta/:itemId
     → 204
```

Validar que el pacienteId del JWT coincide con el de la URL (o que el profesional tenga relación con ese paciente).

---

## Paso 4 — web-patient: reemplazar PanelDiario con Apuntar

### Contexto de lo que existe
- `apps/web-patient/src/pages/Registros.tsx` → tab "Qué comí" llama a `PanelDiario` (componente interno)
- `apps/web-patient/src/components/BuscadorAlimento.tsx` → buscador existente (no usar, reemplazar)
- Tokens de diseño en `packages/design-system/tokens.css`
- Bottom nav ya tiene 6 ítems (máximo); no agregar más

### Qué construir

Crear los siguientes componentes nuevos en `apps/web-patient/src/components/ingesta/`:

#### `ApuntarTab.tsx` — pantalla principal (reemplaza PanelDiario)

Layout completo:
1. **Header verde** (`bg-primary`) con:
   - Fila de navegación de días: `‹ [fecha] ›` donde fecha es "Hoy" / "Ayer" / "Lu 28 oct"
   - 3 barras de progreso: Carbos (amber `#F59E0B`), Proteína (azul `#3B82F6`), Grasa (rosa `#EC4899`)
     - Cada barra: label (60px) + track + fill animado + valor `consumido/metag`
     - Fill = `min(100%, consumido/meta * 100%)`
   - Fila kcal: `[número grande consumido] / [meta] kcal`
2. **Cuerpo scrolleable** con 4 secciones fijas en orden: Desayuno 🌅, Almuerzo ☀️, Cena 🌙, Merienda 🍎
   - Cada sección:
     - Header: ícono + nombre de comida + kcal total de la sección (si hay items)
     - Ítems de comida: nombre | `meta · porción` | chips `C# P# G#` | kcal (alineado derecha)
     - Fila de subtotales si hay ítems: `X/metaC · X/metaP · X/metaG · X/metaKcal`
     - Botón `+ Agregar alimento` que abre `BuscarAlimentoSheet`
3. **Bottom nav** (existente, sin cambios)

Las metas por comida son opcionales en v1; mostrar solo el total del día vs plan_nutricional.

Datos a cargar al montar:
- `GET /api/pacientes/:id/plan-nutricional/vigente`
- `GET /api/pacientes/:id/ingesta?fecha=YYYY-MM-DD`

Recargar ingesta al cambiar día.

#### `BuscarAlimentoSheet.tsx` — bottom sheet de búsqueda

Props: `mealType: 'desayuno'|'almuerzo'|'cena'|'merienda'`, `pacienteId`, `fecha`, `onAdded: () => void`

- Animación slide-up desde abajo (usar el patrón de bottom sheets que ya exista en el proyecto; si no hay, crear con `position:fixed bottom:0` + transform transition)
- Header: botón ✕ + campo de búsqueda (debounce 300ms) + ícono de barcode (no funcional en v1)
- Tabs: **Biblioteca** | **Mis alimentos**
- Lista de resultados: llama a `GET /api/alimentos?q=xxx&fuente=biblioteca` (o `mis-alimentos`)
  - Cada resultado: nombre | categoría · porción default | chips C/P/G | kcal → tap abre `DetalleAlimentoScreen`
- Estado vacío si no hay resultados

#### `DetalleAlimentoScreen.tsx` — detalle + confirmación

Props: `alimento`, `mealType`, `pacienteId`, `fecha`, `onAdded: () => void`, `onBack: () => void`

1. **Header**: botón `‹` + nombre + categoría
2. **Donut chart SVG** (inline) mostrando % kcal por macro (carb×4, prot×4, fat×9 / total)
   - 3 arcos coloreados sobre círculo gris de fondo, r=42, stroke-width=10
3. **4 tiles en grid 2×2**: Carbohidratos | Proteína | Grasa | Calorías
   - Valores recalculados en tiempo real según cantidad y unidad seleccionada
4. **Selector de cantidad**: botón `−` + input numérico + botón `+` (step 0.5, min 0.25)
5. **Chips de unidad**: una chip por `alimento_unidad`, activa la default al abrir
6. **Caja "Aportará a tu dieta"** (fondo `primary-tint`): C / P / G / kcal calculados
7. **Botón "Agregar al [tipo_comida]"**: llama `POST /api/pacientes/:id/ingesta`, cierra el sheet, llama `onAdded()`

Fórmula: `valor = alimento.xxx_100g * (unidad.gramos_equivalentes / 100) * cantidad`

### Integración en Registros.tsx

En `Registros.tsx`, reemplazar en el tab "Qué comí" la referencia a `PanelDiario` por `<ApuntarTab pacienteId={...} />`. Renombrar el tab a "Apuntar" si el cambio no rompe otras referencias. El componente `BuscadorAlimento.tsx` existente puede quedar deprecado pero no hay que borrarlo en esta rama.

---

## Paso 5 — web-professional: formulario Plan Nutricional

En la página de valoración del paciente (`apps/web-professional/src/pages/` — buscar donde se muestra la valoración o el perfil del paciente), que exista una sección "Plan Nutricional" con:

- Formulario con los campos:
  - Fecha inicio (date, requerida)
  - Fecha fin (date, opcional)
  - Meta calorías (número, kcal/día)
  - Meta carbohidratos (número, g/día)
  - Meta proteína (número, g/día)
  - Meta grasa (número, g/día)
  - Meta agua (número, ml/día, opcional)
  - Notas (textarea, opcional)
- Botón guardar → `POST /api/pacientes/:id/plan-nutricional`
- Al cargar la sección: mostrar el plan vigente si existe (`GET /api/pacientes/:id/plan-nutricional/vigente`) con opción de crear uno nuevo
- Diseño consistente con el resto de web-professional (usar los mismos componentes de formulario que ya existen)

---

## Orden de ejecución sugerido

1. Pre-vuelo 022 (si hay acceso a prod)
2. Crear rama
3. Migración 056 (tablas)
4. Migración 057 (seed)
5. Aplicar ambas en dev: `node dist/migrate.js` dentro del contenedor
6. Endpoints backend + pruebas manuales con curl/http
7. `ApuntarTab` + `BuscarAlimentoSheet` + `DetalleAlimentoScreen`
8. Integrar en Registros.tsx
9. Form Plan Nutricional en web-professional
10. Build completo y verificar que no hay errores de TypeScript

---

## Criterios de parada

Parar y reportar si:
- Hay una tabla o columna en el schema actual que contradiga el diseño propuesto aquí
- Algún endpoint de la lista ya existe con un contrato diferente
- El volumen de cambios en Registros.tsx es sustancialmente mayor al esperado (ej. dependencias internas de PanelDiario que no se pueden desconectar limpiamente)

En cualquier otro caso, decidir y avanzar.

---

## Referencia de diseño

El prototipo interactivo HTML con las 3 pantallas (Diario / Buscar / Detalle) fue entregado por separado. Usarlo como referencia visual exacta de:
- Layout del header verde con barras de macros
- Estructura de las secciones de comida con chips C/P/G
- Bottom sheet de búsqueda con tabs y resultados
- Donut chart + tiles + picker de cantidad + caja "Aportará"
- Colores: Carbos `#F59E0B`, Proteína `#3B82F6` (`#60A5FA` suavizado en barras), Grasa `#EC4899`
