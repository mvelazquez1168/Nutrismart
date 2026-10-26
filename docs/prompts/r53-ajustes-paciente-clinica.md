# R53 — Personalización de App Paciente + Multi-profesional por Clínica

## Contexto
NutriSmart monorepo: `apps/api` (Fastify/Node.js), `apps/web-patient` (React/Vite), `apps/web-professional` (React/Vite), `packages/design-system`.

Este release implementa 4 ajustes:
1. **Paleta de colores**: el paciente elige su tema visual entre 10 opciones predefinidas
2. **Avatar / foto de perfil**: el paciente puede subir una foto o usar un avatar de iniciales
3. **Múltiples profesionales por clínica**: cambio de `profesional.clinica_id` a tabla de unión `clinica_profesional`
4. **Ícono de app por clínica**: cada clínica puede subir su propio logo; se muestra en el header/splash de la app del paciente

Rama de trabajo: `git checkout -b r53-personalizacion`

---

## Pre-vuelo (ANTES de tocar código)

```sql
-- Verificar checksum de migración 022 (issue conocido CRLF vs LF)
SELECT version, checksum FROM schema_migrations WHERE version = '022';
-- Si checksum = 'f6f75020b430f0df' (CRLF) ejecutar:
-- UPDATE schema_migrations SET checksum = '40240bc03d9eadce' WHERE version = '022';
```

**Nota**: R52 (ingesta diaria, rama `r52-ingesta-diaria`) se mergeará a main antes de este release. Si ya está mergeado al momento de ejecutar R53, verificar que las migraciones 055–058 estén aplicadas en el entorno. Si no están, no bloquear R53 — reportar el estado y continuar.

---

## Paso 1 — Migraciones de base de datos

### Migración 059 — Paleta, avatar y logo en clínica
Archivo: `apps/api/migrations/059_personalizacion.sql`
Encoding: **UTF-8 sin BOM** (`Set-Content -Encoding UTF8` en PowerShell, luego verificar que no tiene BOM — si lo tiene, reescribir con `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))`)

```sql
-- 059_personalizacion.sql

-- 1. Paleta de color elegida por el paciente
ALTER TABLE paciente
  ADD COLUMN IF NOT EXISTS paleta_color TEXT NOT NULL DEFAULT 'verde'
    CHECK (paleta_color IN (
      'verde','azul-oceano','azul-cielo','turquesa',
      'indigo','violeta','rosa','naranja','rojo','gris'
    ));

-- 2. URL de foto de perfil del paciente (nullable; NULL = usar avatar ilustrado)
ALTER TABLE paciente
  ADD COLUMN IF NOT EXISTS foto_url TEXT;

-- 3b. Campos de avatar ilustrado (ver Paso 4 para detalle)
ALTER TABLE paciente
  ADD COLUMN IF NOT EXISTS avatar_personaje  INTEGER DEFAULT 0 CHECK (avatar_personaje BETWEEN 0 AND 11),
  ADD COLUMN IF NOT EXISTS avatar_skin       TEXT DEFAULT '#FDDCB5',
  ADD COLUMN IF NOT EXISTS avatar_hair_style TEXT DEFAULT 'Largo',
  ADD COLUMN IF NOT EXISTS avatar_hair_color TEXT DEFAULT '#2C1B18',
  ADD COLUMN IF NOT EXISTS avatar_expresion  TEXT DEFAULT 'Sonrisa'
    CHECK (avatar_expresion IN ('Sonrisa','Neutral','Amplia'));

-- 3. URL de logo de la clínica (nullable; NULL = usar logo NutriSmart por defecto)
ALTER TABLE clinica
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 4. Tabla de unión clinica <-> profesional (reemplaza clinica_id en profesional)
CREATE TABLE IF NOT EXISTS clinica_profesional (
  id              SERIAL PRIMARY KEY,
  clinica_id      INTEGER NOT NULL REFERENCES clinica(id) ON DELETE CASCADE,
  profesional_id  INTEGER NOT NULL REFERENCES profesional(id) ON DELETE CASCADE,
  rol             TEXT NOT NULL DEFAULT 'profesional'
    CHECK (rol IN ('admin','profesional')),
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinica_id, profesional_id)
);

CREATE INDEX IF NOT EXISTS idx_clinica_profesional_clinica     ON clinica_profesional(clinica_id);
CREATE INDEX IF NOT EXISTS idx_clinica_profesional_profesional ON clinica_profesional(profesional_id);

-- 5. Migrar datos existentes: copiar la relación actual a la tabla de unión
INSERT INTO clinica_profesional (clinica_id, profesional_id, rol)
SELECT clinica_id, id, 'admin'
FROM   profesional
WHERE  clinica_id IS NOT NULL
ON CONFLICT (clinica_id, profesional_id) DO NOTHING;
```

**Nota importante**: NO eliminar `profesional.clinica_id` en esta migración. Dejarlo como columna legada hasta confirmar que toda la lógica de la API usa `clinica_profesional`. Se puede deprecar en una migración posterior.

---

## Paso 2 — Subida de archivos (API)

### 2.1 Servicio de archivos

La API ya maneja archivos? Verificar si existe algún endpoint de upload. Si no existe, crear `apps/api/src/services/uploadService.ts`:

```typescript
// Usar `@fastify/multipart` (ya en package.json?) o instalarlo.
// Guardar en: /opt/nutrismart/uploads/{tipo}/{uuid}.{ext}
// Retornar URL relativa: /uploads/{tipo}/{uuid}.{ext}
// Servir estáticamente desde Fastify con @fastify/static apuntando a /opt/nutrismart/uploads
// Tipos aceptados para fotos: image/jpeg, image/png, image/webp — max 5 MB
// Tipos aceptados para logos: image/jpeg, image/png, image/webp, image/svg+xml — max 2 MB
```

Si la app corre en Docker, el volumen de uploads ya debe estar montado en `docker-compose.yml` o en el run command del contenedor. Verificar y documentar el path del volumen.

### 2.2 Endpoints nuevos

#### POST /api/paciente/perfil/foto
- Auth: paciente autenticado (Keycloak)
- Recibe: `multipart/form-data` campo `foto` (imagen)
- Procesa: valida tipo y tamaño, guarda en disco, actualiza `paciente.foto_url`
- Responde: `{ foto_url: "/uploads/pacientes/uuid.jpg" }`

#### DELETE /api/paciente/perfil/foto
- Elimina `paciente.foto_url` (pone NULL); opcionalmente borra el archivo
- Responde: `{ ok: true }`

#### PATCH /api/paciente/perfil/avatar
- Body: `{ personaje, skin, hair_style, hair_color, expresion }`
- Actualiza los 5 campos de avatar en `paciente`
- Responde: `{ ok: true }`

#### PATCH /api/paciente/perfil/paleta
- Body: `{ paleta: "azul-oceano" }` (validar contra lista de 10 valores)
- Actualiza `paciente.paleta_color`
- Responde: `{ paleta: "azul-oceano" }`

#### GET /api/paciente/perfil
- Ya existe (o crear si no). Debe retornar: `{ nombre, email, foto_url, paleta_color, ... }`

#### POST /api/admin/clinica/logo (solo rol admin/superadmin)
- Recibe: `multipart/form-data` campo `logo`
- Actualiza `clinica.logo_url` para la clínica del profesional autenticado
- Responde: `{ logo_url: "/uploads/clinicas/uuid.png" }`

---

## Paso 3 — Paletas de color (Design System + app paciente)

### 3.1 Tokens en `packages/design-system/tokens.css`

Añadir las 10 paletas como variables CSS con prefijo de paleta. El JS de la app sobreescribirá `--primary`, `--primary-hover` y `--primary-tint` en el `:root` al cargar la preferencia del paciente.

```css
/* === Paletas de paciente === */
/* Se aplican dinámicamente vía JS sobrescribiendo --primary / --primary-hover / --primary-tint */

/* Valores por paleta (referencia; el JS los lee de este mapa) */
/* verde       #0E7C66 / #0A5C4C / #E7F1EE  ← default actual */
/* azul-oceano #2563EB / #1D4ED8 / #EFF6FF  */
/* azul-cielo  #0284C7 / #0369A1 / #E0F2FE  */
/* turquesa    #0891B2 / #0E7490 / #ECFEFF  */
/* indigo      #4F46E5 / #4338CA / #EEF2FF  */
/* violeta     #7C3AED / #6D28D9 / #F5F3FF  */
/* rosa        #DB2777 / #BE185D / #FDF2F8  */
/* naranja     #EA580C / #C2410C / #FFF7ED  */
/* rojo        #DC2626 / #B91C1C / #FEF2F2  */
/* gris        #475569 / #334155 / #F8FAFC  */
```

### 3.2 Utilidad `apps/web-patient/src/lib/palette.ts`

```typescript
export const PALETTES = {
  'verde':       { primary: '#0E7C66', hover: '#0A5C4C', tint: '#E7F1EE' },
  'azul-oceano': { primary: '#2563EB', hover: '#1D4ED8', tint: '#EFF6FF' },
  'azul-cielo':  { primary: '#0284C7', hover: '#0369A1', tint: '#E0F2FE' },
  'turquesa':    { primary: '#0891B2', hover: '#0E7490', tint: '#ECFEFF' },
  'indigo':      { primary: '#4F46E5', hover: '#4338CA', tint: '#EEF2FF' },
  'violeta':     { primary: '#7C3AED', hover: '#6D28D9', tint: '#F5F3FF' },
  'rosa':        { primary: '#DB2777', hover: '#BE185D', tint: '#FDF2F8' },
  'naranja':     { primary: '#EA580C', hover: '#C2410C', tint: '#FFF7ED' },
  'rojo':        { primary: '#DC2626', hover: '#B91C1C', tint: '#FEF2F2' },
  'gris':        { primary: '#475569', hover: '#334155', tint: '#F8FAFC' },
} as const;

export type PaletteKey = keyof typeof PALETTES;

export function applyPalette(key: PaletteKey) {
  const p = PALETTES[key] ?? PALETTES['verde'];
  const root = document.documentElement;
  root.style.setProperty('--primary',       p.primary);
  root.style.setProperty('--primary-hover', p.hover);
  root.style.setProperty('--primary-tint',  p.tint);
}
```

### 3.3 Aplicar paleta al arrancar la app

En `apps/web-patient/src/App.tsx` (o el componente raíz), después de cargar el perfil del paciente:

```typescript
import { applyPalette, PaletteKey } from '@/lib/palette';
// ...
// Al obtener el perfil:
applyPalette(perfil.paleta_color as PaletteKey);
// También guardar en localStorage como caché para carga inmediata antes del fetch:
const cached = localStorage.getItem('nutrismart_paleta') as PaletteKey | null;
if (cached) applyPalette(cached);
// Después del fetch exitoso:
localStorage.setItem('nutrismart_paleta', perfil.paleta_color);
applyPalette(perfil.paleta_color as PaletteKey);
```

### 3.4 Componente Selector de Paleta

Archivo: `apps/web-patient/src/components/perfil/SelectorPaleta.tsx`

- Grid de 10 círculos de color (2 columnas × 5 filas o 5×2)
- El círculo seleccionado tiene un checkmark encima
- Al tocar un círculo: llama `applyPalette()` de inmediato (preview instantáneo) y hace PATCH `/api/paciente/perfil/paleta`
- Si el PATCH falla, revertir al color anterior y mostrar toast de error
- Label debajo de cada círculo: "Verde", "Azul Océano", "Azul Cielo", "Turquesa", "Índigo", "Violeta", "Rosa", "Naranja", "Rojo", "Gris"

---

## Paso 4 — Avatar del paciente (galería + personalización)

El sistema de avatar tiene dos capas:
1. El paciente elige un **personaje base** de una galería de 12 diseños ilustrados (diversidad de género, tono de piel, cabello)
2. Puede **personalizar** el personaje elegido: tono de piel (5 opciones), estilo de cabello (7 opciones), color de cabello (7 opciones), expresión (3 opciones)
3. Opcionalmente puede **subir su foto real** (foto reemplaza al avatar ilustrado, pero el avatar queda guardado como fallback)

El avatar se genera como SVG inline en el frontend — no requiere almacenamiento de archivos de imagen para la parte ilustrada.

### 4.1 Modelo de datos

```sql
-- En la migración 059 (ya definida arriba), agregar estos campos a paciente:
ALTER TABLE paciente
  ADD COLUMN IF NOT EXISTS avatar_personaje INTEGER DEFAULT 0 CHECK (avatar_personaje BETWEEN 0 AND 11),
  ADD COLUMN IF NOT EXISTS avatar_skin      TEXT DEFAULT '#FDDCB5',
  ADD COLUMN IF NOT EXISTS avatar_hair_style TEXT DEFAULT 'Largo',
  ADD COLUMN IF NOT EXISTS avatar_hair_color TEXT DEFAULT '#2C1B18',
  ADD COLUMN IF NOT EXISTS avatar_expresion  TEXT DEFAULT 'Sonrisa'
    CHECK (avatar_expresion IN ('Sonrisa','Neutral','Amplia'));
```

Los campos `foto_url` y los de avatar coexisten: si `foto_url` no es NULL se muestra la foto; si es NULL se renderiza el SVG generado con los parámetros de avatar.

### 4.2 Generador de avatares `avatar.ts`

Archivo: `apps/web-patient/src/components/perfil/avatar.ts`

Implementar la función `makeFaceSVG(config)` que genera un SVG 100×100 con:
- Fondo degradado circular (usa los colores de la paleta activa del paciente: `var(--primary)` → `var(--primary-hover)`)
- Cara ilustrada con: tono de piel, cabello (back + crown, 7 estilos), ojos, cejas, nariz, boca, mejillas ruborizadas
- Estilo de cabello: `Corto`, `Largo`, `Rizado`, `Ondulado`, `Moño`, `Corto M`, `Calvo`
- Expresiones: `Sonrisa`, `Neutral`, `Amplia`

La galería de 12 personajes base define configuraciones `skin + hairStyle + hairColor + eyeColor + expresion` por defecto. Al seleccionar un personaje, sus valores se cargan en el estado de personalización y el paciente puede ajustarlos.

### 4.3 Componente Avatar genérico

Archivo: `apps/web-patient/src/components/perfil/Avatar.tsx`

```typescript
// Props: { paciente: { foto_url, avatar_personaje, avatar_skin, avatar_hair_style, avatar_hair_color, avatar_expresion, nombre }; size?: 'sm'|'md'|'lg' }
// Si foto_url: <img> con la URL
// Si no: SVG generado con makeFaceSVG() usando los parámetros almacenados
// Sizes: sm=32px, md=48px, lg=104px
```

### 4.4 Pantalla de edición de perfil

Archivo: `apps/web-patient/src/components/perfil/PerfilScreen.tsx`

Secciones:
1. **Elegir avatar**
   - Grid 4×3 de los 12 personajes base (SVG renderizado, sin personalización)
   - Al seleccionar uno: cargar sus valores por defecto en el constructor de abajo
2. **Personalizar**
   - Preview grande del avatar actual (con los parámetros actuales)
   - Selector tono de piel (5 swatches de color)
   - Selector estilo de cabello (7 pills)
   - Selector color de cabello (7 dots)
   - Selector expresión (3 pills)
   - Botón "Guardar avatar" → PATCH `/api/paciente/perfil/avatar`
3. **O subir mi foto** (sección colapsable)
   - Input file, preview, botón guardar → POST `/api/paciente/perfil/foto`
   - Botón eliminar foto (vuelve al avatar ilustrado)
4. **Paleta de colores** → `<SelectorPaleta />`

### 4.5 Endpoints para avatar

```
PATCH /api/paciente/perfil/avatar
Body: { personaje, skin, hair_style, hair_color, expresion }
→ Actualiza los 5 campos de avatar en paciente
→ Responde: { ok: true }
```

Los endpoints de foto (`POST/DELETE /api/paciente/perfil/foto`) permanecen como se definieron en el Paso 2.

### 4.6 Mostrar Avatar en la app

- Cabecera/navbar superior: `<Avatar size="sm" />` junto al nombre del paciente
- Si ya existe un componente de header, integrarlo ahí

---

## Paso 5 — Logo de clínica por app del paciente

### 5.1 Qué se configura

- Cada clínica puede tener un `logo_url` (imagen) que reemplaza el logo de NutriSmart en:
  - El header de la app del paciente (esquina superior izquierda o centro)
  - La pantalla de splash/login del paciente (si existe)
- Si `clinica.logo_url` es NULL → mostrar el logo/nombre "NutriSmart" por defecto

### 5.2 API: obtener config de la clínica del paciente

Endpoint existente o nuevo: `GET /api/paciente/clinica-config`
```json
{
  "clinica_nombre": "Clínica Salud Total",
  "logo_url": "/uploads/clinicas/abc123.png"
}
```
- El paciente pertenece a un profesional que pertenece a una clínica → devolver los datos de esa clínica

### 5.3 Frontend paciente

En `App.tsx` o en el context de la app, al cargar:
1. Fetch `GET /api/paciente/clinica-config`
2. Guardar `logo_url` y `clinica_nombre` en context
3. El componente de header usa `logo_url` si está disponible; si no, usa el logo por defecto

### 5.4 Panel web-professional: subir logo

En `apps/web-professional` → sección de configuración de clínica (crear si no existe):
- Input para subir logo (image/*, max 2MB, recomendado fondo transparente PNG o SVG)
- Preview del logo actual
- Botón "Guardar logo" → POST `/api/admin/clinica/logo`
- Solo rol admin de la clínica puede hacerlo

---

## Paso 6 — Multi-profesional por clínica

### 6.1 Contexto de esquema actual

Verificar el esquema actual de `profesional`:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'profesional' ORDER BY ordinal_position;
```

Verificar que `clinica_profesional` fue creada por la migración 059.

### 6.2 Cambios en la API

Toda lógica que haga `WHERE p.clinica_id = ?` o `JOIN profesional p ON p.clinica_id = c.id` debe migrarse a usar `clinica_profesional`:

```sql
-- Antes:
SELECT * FROM profesional WHERE clinica_id = $1

-- Después:
SELECT p.* FROM profesional p
JOIN clinica_profesional cp ON cp.profesional_id = p.id
WHERE cp.clinica_id = $1 AND cp.activo = TRUE
```

Buscar con `grep -rn "clinica_id" apps/api/src/` para encontrar todos los lugares afectados.

### 6.3 Endpoints de gestión (web-professional, rol admin)

#### GET /api/admin/clinica/profesionales
- Lista todos los profesionales de la clínica del usuario autenticado
- Responde: `[{ id, nombre, email, rol, activo }]`

#### POST /api/admin/clinica/profesionales
- Body: `{ email: string }` — invitar a un profesional existente en el sistema por email
- Crea registro en `clinica_profesional` con rol='profesional'
- Responde: `{ ok: true, profesional_id: number }`

#### PATCH /api/admin/clinica/profesionales/:id
- Body: `{ rol?: 'admin'|'profesional', activo?: boolean }`
- Solo admin puede cambiar rol de otro profesional
- Responde: `{ ok: true }`

#### DELETE /api/admin/clinica/profesionales/:id
- Desactiva (`activo = FALSE`) en lugar de eliminar
- Un admin no puede desactivarse a sí mismo si es el único admin
- Responde: `{ ok: true }`

### 6.4 UI en web-professional

Sección "Equipo" en configuración de clínica:
- Tabla/lista de profesionales con nombre, email, rol y estado (activo/inactivo)
- Botón "Agregar profesional" → modal con campo email
- Acciones por profesional: cambiar rol, desactivar/activar

---

## Paso 7 — Pruebas

### 7.1 Pruebas con Puppeteer (390×844 viewport)

1. **Paleta**: abrir app paciente → ir a Perfil → ver selector de 10 paletas → tocar "Azul Océano" → verificar que header y botones cambian a azul → recargar → verificar que la paleta persiste (caché localStorage + fetch)
2. **Avatar galería**: abrir Perfil → ver grid de 12 personajes → seleccionar uno → ajustar tono de piel y cabello → guardar → verificar que el avatar aparece en el header. Subir foto → verificar que reemplaza al ilustrado. Eliminar foto → vuelve el avatar ilustrado.
3. **Logo clínica**: subir logo desde web-professional → abrir app paciente → verificar que aparece el logo de la clínica en el header
4. **Multi-profesional**: crear segundo profesional en la clínica → verificar que ambos aparecen en la lista → cambiar rol del segundo a 'admin' → verificar → desactivar → verificar que no aparece activo

### 7.2 Verificación de migración

```bash
# Dentro del contenedor de la API:
node dist/migrate.js
# Verificar tablas:
# SELECT column_name FROM information_schema.columns WHERE table_name = 'paciente' AND column_name IN ('paleta_color', 'foto_url');
# SELECT column_name FROM information_schema.columns WHERE table_name = 'clinica' AND column_name = 'logo_url';
# SELECT COUNT(*) FROM clinica_profesional;
```

---

## Criterios de parada (stop criteria)

Detener y reportar si:
- La migración 059 falla por un constraint o tipo de dato incompatible → reportar el error exacto y SQL fallido
- `@fastify/multipart` o `@fastify/static` no están instalados y `npm install` falla → reportar
- El volumen de uploads no está configurado en Docker → reportar path y cómo configurarlo
- Cualquier test de Puppeteer falla 2 veces → reportar screenshot y error

---

## Entregables esperados al finalizar

1. Migración `059_personalizacion.sql` aplicada en dev
2. `packages/design-system/tokens.css` — comentario con mapa de paletas
3. `apps/web-patient/src/lib/palette.ts`
4. `apps/web-patient/src/components/perfil/avatar.ts` (generador SVG)
5. `apps/web-patient/src/components/perfil/Avatar.tsx` (componente)
6. `apps/web-patient/src/components/perfil/SelectorPaleta.tsx`
7. `apps/web-patient/src/components/perfil/PerfilScreen.tsx`
8. Endpoints en `apps/api/src/routes/paciente/` (foto, avatar, paleta, clinica-config)
9. Endpoint en `apps/api/src/routes/admin/clinica/` (logo, profesionales CRUD)
10. Sección "Equipo" en `apps/web-professional`
11. Sección "Logo de clínica" en `apps/web-professional`
12. Integración del logo en el header de `apps/web-patient`
13. PR abierto con rama `r53-personalizacion`

Reportar commit hash, número de tests y cualquier decisión de diseño que requiera confirmación.
