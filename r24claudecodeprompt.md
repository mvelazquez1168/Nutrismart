# R24 — PAC-07 Contador de porciones + PAC-08 Biblioteca de recursos

## Contexto obligatorio — leer antes de tocar cualquier archivo

- Monorepo: `apps/api` (Fastify), `apps/web-patient` (Vite + React, puerto 5175), `apps/web-professional` (Vite + React, puerto 5173)
- Columnas reales: `paciente.correo`, `paciente.nombre_completo`, `paciente.estado`, `paciente.sexo_biologico`, `clinica.nombre_comercial`
- `clinica_id` del paciente: `SELECT clinica_id FROM paciente WHERE keycloak_user_id = request.user.sub`
- `clinica_id` del profesional: `request.auth.tenantId`
- `profesional_id` del profesional: `SELECT id FROM profesional WHERE keycloak_user_id = $1 AND clinica_id = $2`
- Colores vía CSS vars o Tailwind design tokens — nunca hex hardcodeado
- Nunca DELETE físico — soft-delete con `activo = false`
- Gráficas solo SVG — sin recharts ni ninguna librería de charting externa
- Framework API: **Fastify** — nunca Express
- Tablas ya existentes relevantes: `registro_comida`, `registro_metrica`, `tarea_paciente`, `consulta`, `clinica`, `paciente`, `profesional`

---

## Paso 0 — Verificar prerequisitos

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('registro_comida', 'tarea_paciente', 'profesional');
```

Si alguna falta, detener y avisar: "Ejecuta r23 primero."

---

## Paso 1 — Migration 025: catálogo de alimentos + ítems de comida + configuración del paciente

Crear `apps/api/src/db/migrations/025_alimento_catalogo.sql`:

```sql
-- Catálogo de alimentos (NULL clinica_id = catálogo global; non-null = propio de la clínica)
CREATE TABLE alimento_catalogo (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id          UUID        REFERENCES clinica(id),         -- NULL = global
  nombre              TEXT        NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 200),
  sinonimos           TEXT[]      NOT NULL DEFAULT '{}',           -- para búsqueda ILIKE
  kcal_por_100g       NUMERIC(7,2),
  proteina_por_100g   NUMERIC(6,2),
  carbs_por_100g      NUMERIC(6,2),
  grasas_por_100g     NUMERIC(6,2),
  porcion_tipica_g    NUMERIC(6,1) NOT NULL DEFAULT 100,
  unidad_porcion      TEXT        NOT NULL DEFAULT 'g',
  categoria           TEXT        NOT NULL DEFAULT 'otro'
                        CHECK (categoria IN ('cereales','leguminosas','carnes','lacteos',
                                             'frutas','verduras','bebidas','grasas','otro')),
  activo              BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alimento_nombre ON alimento_catalogo USING gin(to_tsvector('spanish', nombre));
CREATE INDEX idx_alimento_clinica ON alimento_catalogo (clinica_id) WHERE activo = true;

-- Ítems individuales dentro de un registro_comida (modo detallado)
CREATE TABLE registro_comida_item (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_comida_id  UUID        NOT NULL REFERENCES registro_comida(id) ON DELETE CASCADE,
  clinica_id          UUID        NOT NULL REFERENCES clinica(id),
  alimento_id         UUID        REFERENCES alimento_catalogo(id), -- NULL = alimento personalizado
  nombre_alimento     TEXT        NOT NULL CHECK (char_length(nombre_alimento) BETWEEN 1 AND 200),
  cantidad_g          NUMERIC(7,1) NOT NULL CHECK (cantidad_g > 0),
  kcal                NUMERIC(7,1),
  proteina_g          NUMERIC(6,1),
  carbohidratos_g     NUMERIC(6,1),
  grasas_g            NUMERIC(6,1),
  activo              BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_item_registro ON registro_comida_item (registro_comida_id) WHERE activo = true;

-- Preferencias del paciente por clínica
CREATE TABLE configuracion_paciente (
  paciente_id     UUID        NOT NULL REFERENCES paciente(id),
  clinica_id      UUID        NOT NULL REFERENCES clinica(id),
  modo_diario     TEXT        NOT NULL DEFAULT 'simple'
                    CHECK (modo_diario IN ('simple', 'detallado')),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (paciente_id, clinica_id)
);
```

Ejecutar la migración:

```typescript
// apps/api/src/db/migrate.ts (o el runner existente)
// Añadir '025_alimento_catalogo.sql' a la lista ordenada de migraciones
```

---

## Paso 2 — Seed del catálogo global (35 alimentos comunes)

Crear `apps/api/src/db/seeds/025_alimentos_seed.sql` y ejecutarlo **solo si `alimento_catalogo` está vacía**:

```sql
INSERT INTO alimento_catalogo
  (clinica_id, nombre, sinonimos, kcal_por_100g, proteina_por_100g, carbs_por_100g, grasas_por_100g, porcion_tipica_g, unidad_porcion, categoria)
VALUES
-- Cereales
  (NULL, 'Tortilla de maíz',      '{"tortilla","taco"}',           218, 5.7,  44.6, 2.5,  30,  'g',   'cereales'),
  (NULL, 'Arroz blanco cocido',   '{"arroz"}',                     130, 2.7,  28.2, 0.3,  150, 'g',   'cereales'),
  (NULL, 'Pan blanco',            '{"pan de caja","pan bimbo"}',   265, 9.0,  49.0, 3.2,  30,  'g',   'cereales'),
  (NULL, 'Pan integral',          '{"pan negro","pan de trigo"}',  247, 13.0, 41.3, 4.2,  30,  'g',   'cereales'),
  (NULL, 'Avena cocida',          '{"oatmeal","avena"}',           71,  2.5,  12.0, 1.5,  250, 'g',   'cereales'),
  (NULL, 'Pasta cocida',          '{"fideos","espagueti"}',        158, 5.8,  30.9, 0.9,  180, 'g',   'cereales'),
  (NULL, 'Tostada de maíz',       '{"tostada"}',                   389, 9.0,  73.0, 5.8,  20,  'pza', 'cereales'),
-- Leguminosas
  (NULL, 'Frijoles negros cocidos','{"frijoles","judías negras"}', 132, 8.9,  23.7, 0.5,  120, 'g',   'leguminosas'),
  (NULL, 'Lentejas cocidas',       '{"lentejas"}',                 116, 9.0,  20.1, 0.4,  100, 'g',   'leguminosas'),
  (NULL, 'Garbanzo cocido',        '{"garbanzo"}',                 164, 8.9,  27.4, 2.6,  100, 'g',   'leguminosas'),
-- Carnes y proteína
  (NULL, 'Pechuga de pollo',       '{"pollo","filete de pollo"}',  165, 31.0, 0.0,  3.6,  100, 'g',   'carnes'),
  (NULL, 'Carne molida de res 90/10','{"carne molida","res"}',     218, 26.1, 0.0,  12.3, 100, 'g',   'carnes'),
  (NULL, 'Atún en agua',           '{"atún","tuna"}',              108, 23.6, 0.0,  0.9,  100, 'g',   'carnes'),
  (NULL, 'Huevo entero',           '{"huevo","blanquillos"}',      155, 12.6, 1.1,  10.6, 60,  'pza', 'carnes'),
  (NULL, 'Salmón',                 '{"salmon","filete salmón"}',   208, 20.4, 0.0,  13.4, 100, 'g',   'carnes'),
  (NULL, 'Claras de huevo',        '{"claras"}',                   52,  10.9, 0.7,  0.2,  100, 'ml',  'carnes'),
-- Lácteos
  (NULL, 'Leche entera',           '{"leche"}',                    61,  3.2,  4.8,  3.3,  240, 'ml',  'lacteos'),
  (NULL, 'Leche descremada',       '{"leche light"}',              34,  3.4,  5.0,  0.1,  240, 'ml',  'lacteos'),
  (NULL, 'Yogur griego natural',   '{"yogurt griego","yogur"}',    59,  10.2, 3.6,  0.4,  150, 'g',   'lacteos'),
  (NULL, 'Queso panela',           '{"panela"}',                   290, 19.0, 2.0,  23.0, 40,  'g',   'lacteos'),
  (NULL, 'Queso Oaxaca',           '{"quesillo","oaxaca"}',        395, 26.0, 1.0,  32.0, 40,  'g',   'lacteos'),
-- Frutas
  (NULL, 'Manzana',                '{"apple","manzana roja"}',     52,  0.3,  13.8, 0.2,  180, 'pza', 'frutas'),
  (NULL, 'Plátano',                '{"banana","plátano tabasco"}', 89,  1.1,  22.8, 0.3,  120, 'pza', 'frutas'),
  (NULL, 'Naranja',                '{"orange","mandarina"}',       47,  0.9,  11.8, 0.1,  180, 'pza', 'frutas'),
  (NULL, 'Papaya',                 '{"lechosa","papaya"}',         43,  0.5,  10.8, 0.3,  150, 'g',   'frutas'),
  (NULL, 'Mango',                  '{"mango manila","mango"}',     60,  0.8,  15.0, 0.4,  150, 'g',   'frutas'),
-- Verduras
  (NULL, 'Brócoli cocido',         '{"brócoli","brocoli"}',        35,  2.4,  7.2,  0.4,  150, 'g',   'verduras'),
  (NULL, 'Zanahoria',              '{"carrot","zanahoria"}',       41,  0.9,  9.6,  0.2,  80,  'g',   'verduras'),
  (NULL, 'Aguacate',               '{"avocado","palta"}',          160, 2.0,  8.5,  14.7, 80,  'g',   'verduras'),
  (NULL, 'Jitomate',               '{"tomate","jitomate bola"}',   18,  0.9,  3.9,  0.2,  120, 'g',   'verduras'),
-- Bebidas
  (NULL, 'Agua natural',           '{"agua"}',                     0,   0.0,  0.0,  0.0,  250, 'ml',  'bebidas'),
  (NULL, 'Café americano',         '{"cafe","americano"}',         2,   0.3,  0.0,  0.0,  240, 'ml',  'bebidas'),
  (NULL, 'Jugo de naranja natural','{"jugo naranja","oj"}',        45,  0.7,  10.4, 0.2,  240, 'ml',  'bebidas'),
-- Grasas y condimentos
  (NULL, 'Aceite de oliva',        '{"aove","aceite oliva"}',      884, 0.0,  0.0,  100.0,10,  'ml',  'grasas'),
  (NULL, 'Almendras',              '{"almendra"}',                 579, 21.2, 21.6, 49.9, 30,  'g',   'grasas')
ON CONFLICT DO NOTHING;
```

En el runner de migraciones, ejecutar este seed solo si `SELECT COUNT(*) FROM alimento_catalogo` devuelve 0.

---

## Paso 3 — Migration 026: recursos para el paciente (biblioteca)

Crear `apps/api/src/db/migrations/026_recurso_pac.sql`:

```sql
CREATE TABLE recurso_pac (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      UUID        NOT NULL REFERENCES clinica(id),
  profesional_id  UUID        NOT NULL REFERENCES profesional(id),
  titulo          TEXT        NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 200),
  resumen         TEXT        CHECK (char_length(resumen) <= 500),
  contenido       TEXT        NOT NULL CHECK (char_length(contenido) >= 1),
  categoria       TEXT        NOT NULL DEFAULT 'otro'
                    CHECK (categoria IN ('nutricion','ejercicio','habitos','recetas','otro')),
  imagen_url      TEXT,
  publicado       BOOLEAN     NOT NULL DEFAULT false,
  publicado_en    TIMESTAMPTZ,
  activo          BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recurso_pac_clinica_pub
  ON recurso_pac (clinica_id, publicado_en DESC)
  WHERE publicado = true AND activo = true;

-- Registro de lecturas por paciente (UPSERT para "marcar como leído")
CREATE TABLE recurso_pac_lectura (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recurso_id  UUID        NOT NULL REFERENCES recurso_pac(id) ON DELETE CASCADE,
  paciente_id UUID        NOT NULL REFERENCES paciente(id),
  clinica_id  UUID        NOT NULL REFERENCES clinica(id),
  leido_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lectura UNIQUE (recurso_id, paciente_id)
);

CREATE INDEX idx_lectura_paciente ON recurso_pac_lectura (paciente_id, clinica_id);
```

---

## Paso 4 — API: PAC-07 catálogo de alimentos e ítems

Crear `apps/api/src/paciente/alimentos.ts`:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

export async function alimentosRoutes(app: FastifyInstance, pool: Pool) {

  // GET /api/alimentos?q=texto&categoria=frutas  (acceso público para autenticados)
  app.get('/api/alimentos', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { q = '', categoria } = req.query as { q?: string; categoria?: string }

    // Busca en catálogo global (clinica_id IS NULL) + catálogo propio de la clínica del usuario
    const clinicaId = (req as any).auth?.tenantId
      ?? await resolveClinicaId(pool, (req as any).user.sub)

    const rows = await pool.query(
      `SELECT id, nombre, sinonimos, kcal_por_100g, proteina_por_100g,
              carbs_por_100g, grasas_por_100g, porcion_tipica_g, unidad_porcion, categoria
       FROM alimento_catalogo
       WHERE activo = true
         AND (clinica_id IS NULL OR clinica_id = $1)
         AND ($2 = '' OR nombre ILIKE $3 OR EXISTS (
               SELECT 1 FROM unnest(sinonimos) s WHERE s ILIKE $3
             ))
         AND ($4::text IS NULL OR categoria = $4)
       ORDER BY
         CASE WHEN clinica_id = $1 THEN 0 ELSE 1 END,  -- propios primero
         nombre
       LIMIT 20`,
      [clinicaId, q, q ? `%${q}%` : '', categoria ?? null]
    )
    return rows.rows
  })

  // GET /api/paciente/configuracion
  app.get('/api/paciente/configuracion', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const { rows } = await pool.query(
      `SELECT p.id AS paciente_id, p.clinica_id,
              COALESCE(c.modo_diario, 'simple') AS modo_diario
       FROM paciente p
       LEFT JOIN configuracion_paciente c ON c.paciente_id = p.id AND c.clinica_id = p.clinica_id
       WHERE p.keycloak_user_id = $1`,
      [sub]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Paciente no encontrado' })
    return { modo_diario: rows[0].modo_diario }
  })

  // PATCH /api/paciente/configuracion
  app.patch('/api/paciente/configuracion', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const { modo_diario } = req.body as { modo_diario: 'simple' | 'detallado' }
    if (!['simple', 'detallado'].includes(modo_diario))
      return reply.code(400).send({ error: 'modo_diario inválido' })

    const { rows } = await pool.query(
      `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`,
      [sub]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Paciente no encontrado' })
    const { id: pacienteId, clinica_id: clinicaId } = rows[0]

    await pool.query(
      `INSERT INTO configuracion_paciente (paciente_id, clinica_id, modo_diario, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (paciente_id, clinica_id) DO UPDATE
         SET modo_diario = EXCLUDED.modo_diario, updated_at = now()`,
      [pacienteId, clinicaId, modo_diario]
    )
    return { modo_diario }
  })

  // GET /api/paciente/diario/:registroId/items
  app.get('/api/paciente/diario/:registroId/items', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const { registroId } = req.params as { registroId: string }

    // Verificar propiedad del registro
    const { rows: ownership } = await pool.query(
      `SELECT rc.id FROM registro_comida rc
       JOIN paciente p ON p.id = rc.paciente_id
       WHERE rc.id = $1 AND p.keycloak_user_id = $2 AND rc.activo = true`,
      [registroId, sub]
    )
    if (!ownership.length) return reply.code(404).send({ error: 'Registro no encontrado' })

    const { rows } = await pool.query(
      `SELECT id, alimento_id, nombre_alimento, cantidad_g,
              kcal, proteina_g, carbohidratos_g, grasas_g, created_at
       FROM registro_comida_item
       WHERE registro_comida_id = $1 AND activo = true
       ORDER BY created_at`,
      [registroId]
    )
    return rows
  })

  // POST /api/paciente/diario/:registroId/items
  app.post('/api/paciente/diario/:registroId/items', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const { registroId } = req.params as { registroId: string }
    const { alimento_id, nombre_alimento, cantidad_g } =
      req.body as { alimento_id?: string; nombre_alimento?: string; cantidad_g: number }

    if (!cantidad_g || cantidad_g <= 0)
      return reply.code(400).send({ error: 'cantidad_g debe ser mayor a 0' })

    // Verificar propiedad y obtener clinica_id
    const { rows: ownership } = await pool.query(
      `SELECT rc.id, rc.clinica_id FROM registro_comida rc
       JOIN paciente p ON p.id = rc.paciente_id
       WHERE rc.id = $1 AND p.keycloak_user_id = $2 AND rc.activo = true`,
      [registroId, sub]
    )
    if (!ownership.length) return reply.code(404).send({ error: 'Registro no encontrado' })
    const clinicaId = ownership[0].clinica_id

    let nombreFinal = nombre_alimento
    let kcal: number | null = null
    let proteina: number | null = null
    let carbs: number | null = null
    let grasas: number | null = null

    if (alimento_id) {
      const { rows: alimento } = await pool.query(
        `SELECT nombre, kcal_por_100g, proteina_por_100g, carbs_por_100g, grasas_por_100g
         FROM alimento_catalogo WHERE id = $1 AND activo = true`,
        [alimento_id]
      )
      if (!alimento.length) return reply.code(404).send({ error: 'Alimento no encontrado' })
      const a = alimento[0]
      nombreFinal = a.nombre
      // Calcular nutrientes proporcionales a cantidad_g
      const factor = cantidad_g / 100
      kcal     = a.kcal_por_100g      != null ? +(a.kcal_por_100g      * factor).toFixed(1) : null
      proteina = a.proteina_por_100g  != null ? +(a.proteina_por_100g  * factor).toFixed(1) : null
      carbs    = a.carbs_por_100g     != null ? +(a.carbs_por_100g     * factor).toFixed(1) : null
      grasas   = a.grasas_por_100g    != null ? +(a.grasas_por_100g    * factor).toFixed(1) : null
    }

    if (!nombreFinal) return reply.code(400).send({ error: 'nombre_alimento requerido para alimentos personalizados' })

    const { rows } = await pool.query(
      `INSERT INTO registro_comida_item
         (registro_comida_id, clinica_id, alimento_id, nombre_alimento, cantidad_g, kcal, proteina_g, carbohidratos_g, grasas_g)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [registroId, clinicaId, alimento_id ?? null, nombreFinal, cantidad_g, kcal, proteina, carbs, grasas]
    )

    // Recalcular totales del registro_comida a partir de sus ítems activos
    await recalcularTotalesRegistro(pool, registroId)

    return reply.code(201).send(rows[0])
  })

  // DELETE /api/paciente/diario/:registroId/items/:itemId  (soft-delete)
  app.delete('/api/paciente/diario/:registroId/items/:itemId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const { registroId, itemId } = req.params as { registroId: string; itemId: string }

    const { rows: ownership } = await pool.query(
      `SELECT rc.id FROM registro_comida rc
       JOIN paciente p ON p.id = rc.paciente_id
       WHERE rc.id = $1 AND p.keycloak_user_id = $2 AND rc.activo = true`,
      [registroId, sub]
    )
    if (!ownership.length) return reply.code(404).send({ error: 'Registro no encontrado' })

    const { rowCount } = await pool.query(
      `UPDATE registro_comida_item SET activo = false
       WHERE id = $1 AND registro_comida_id = $2`,
      [itemId, registroId]
    )
    if (!rowCount) return reply.code(404).send({ error: 'Ítem no encontrado' })

    await recalcularTotalesRegistro(pool, registroId)
    return reply.code(204).send()
  })
}

// Recalcula kcal y macros del registro_comida a partir de sus ítems activos
async function recalcularTotalesRegistro(pool: Pool, registroId: string) {
  await pool.query(
    `UPDATE registro_comida SET
       kcal             = (SELECT ROUND(SUM(kcal)::numeric, 1)           FROM registro_comida_item WHERE registro_comida_id = $1 AND activo = true),
       proteina_g       = (SELECT ROUND(SUM(proteina_g)::numeric, 1)     FROM registro_comida_item WHERE registro_comida_id = $1 AND activo = true),
       carbohidratos_g  = (SELECT ROUND(SUM(carbohidratos_g)::numeric, 1)FROM registro_comida_item WHERE registro_comida_id = $1 AND activo = true),
       grasas_g         = (SELECT ROUND(SUM(grasas_g)::numeric, 1)       FROM registro_comida_item WHERE registro_comida_id = $1 AND activo = true),
       updated_at       = now()
     WHERE id = $1`,
    [registroId]
  )
}

async function resolveClinicaId(pool: Pool, sub: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT clinica_id FROM paciente WHERE keycloak_user_id = $1`, [sub]
  )
  return rows[0]?.clinica_id
}
```

Registrar en `apps/api/src/server.ts`:

```typescript
import { alimentosRoutes } from './paciente/alimentos.js'
// ...dentro de la función de registro de rutas:
await app.register(alimentosRoutes, { pool })
```

---

## Paso 5 — API: PAC-08 biblioteca de recursos (paciente)

Crear `apps/api/src/paciente/recursos.ts`:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

export async function recursosRoutes(app: FastifyInstance, pool: Pool) {

  // GET /api/paciente/recursos?categoria=nutricion&pagina=1
  app.get('/api/paciente/recursos', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const { categoria, pagina = '1' } = req.query as { categoria?: string; pagina?: string }
    const page = Math.max(1, parseInt(pagina, 10))
    const limit = 12
    const offset = (page - 1) * limit

    const { rows: [paciente] } = await pool.query(
      `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`, [sub]
    )
    if (!paciente) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const { rows } = await pool.query(
      `SELECT r.id, r.titulo, r.resumen, r.categoria, r.imagen_url, r.publicado_en,
              (l.leido_en IS NOT NULL) AS leido,
              p.nombre_completo AS autor
       FROM recurso_pac r
       LEFT JOIN recurso_pac_lectura l
              ON l.recurso_id = r.id AND l.paciente_id = $1
       JOIN profesional p ON p.id = r.profesional_id
       WHERE r.clinica_id = $2
         AND r.publicado = true AND r.activo = true
         AND ($3::text IS NULL OR r.categoria = $3)
       ORDER BY r.publicado_en DESC
       LIMIT $4 OFFSET $5`,
      [paciente.id, paciente.clinica_id, categoria ?? null, limit, offset]
    )

    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*) AS total FROM recurso_pac
       WHERE clinica_id = $1 AND publicado = true AND activo = true
         AND ($2::text IS NULL OR categoria = $2)`,
      [paciente.clinica_id, categoria ?? null]
    )

    return { recursos: rows, total: parseInt(total), pagina: page, limite: limit }
  })

  // GET /api/paciente/recursos/:id  → devuelve contenido completo + marca como leído
  app.get('/api/paciente/recursos/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const { id } = req.params as { id: string }

    const { rows: [paciente] } = await pool.query(
      `SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1`, [sub]
    )
    if (!paciente) return reply.code(404).send({ error: 'Paciente no encontrado' })

    const { rows: [recurso] } = await pool.query(
      `SELECT r.id, r.titulo, r.resumen, r.contenido, r.categoria,
              r.imagen_url, r.publicado_en,
              p.nombre_completo AS autor
       FROM recurso_pac r
       JOIN profesional p ON p.id = r.profesional_id
       WHERE r.id = $1 AND r.clinica_id = $2
         AND r.publicado = true AND r.activo = true`,
      [id, paciente.clinica_id]
    )
    if (!recurso) return reply.code(404).send({ error: 'Recurso no encontrado' })

    // Marcar como leído (UPSERT — idempotente)
    await pool.query(
      `INSERT INTO recurso_pac_lectura (recurso_id, paciente_id, clinica_id, leido_en)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (recurso_id, paciente_id) DO NOTHING`,
      [id, paciente.id, paciente.clinica_id]
    )

    return recurso
  })
}
```

Registrar en `apps/api/src/server.ts`:

```typescript
import { recursosRoutes } from './paciente/recursos.js'
await app.register(recursosRoutes, { pool })
```

---

## Paso 6 — API: PAC-08 gestión de recursos (profesional)

Crear `apps/api/src/profesional/recursos.ts`:

```typescript
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

export async function recursosProRoutes(app: FastifyInstance, pool: Pool) {

  async function resolveProId(pool: Pool, sub: string, clinicaId: string): Promise<string> {
    const { rows } = await pool.query(
      `SELECT id FROM profesional WHERE keycloak_user_id = $1 AND clinica_id = $2`, [sub, clinicaId]
    )
    if (!rows.length) throw new Error('Profesional no encontrado')
    return rows[0].id
  }

  // GET /api/profesional/recursos?categoria=&publicado=true|false
  app.get('/api/profesional/recursos', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const clinicaId = (req as any).auth.tenantId
    const proId = await resolveProId(pool, sub, clinicaId)
    const { categoria, publicado } = req.query as { categoria?: string; publicado?: string }

    const { rows } = await pool.query(
      `SELECT r.id, r.titulo, r.resumen, r.categoria, r.imagen_url,
              r.publicado, r.publicado_en, r.activo,
              r.created_at, r.updated_at,
              (SELECT COUNT(*) FROM recurso_pac_lectura l WHERE l.recurso_id = r.id) AS lecturas
       FROM recurso_pac r
       WHERE r.clinica_id = $1 AND r.activo = true
         AND ($2::text IS NULL OR r.categoria = $2)
         AND ($3::boolean IS NULL OR r.publicado = $3)
       ORDER BY r.updated_at DESC`,
      [clinicaId, categoria ?? null, publicado != null ? publicado === 'true' : null]
    )
    return rows
  })

  // POST /api/profesional/recursos
  app.post('/api/profesional/recursos', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sub = (req as any).user.sub
    const clinicaId = (req as any).auth.tenantId
    const proId = await resolveProId(pool, sub, clinicaId)
    const { titulo, resumen, contenido, categoria, imagen_url } =
      req.body as { titulo: string; resumen?: string; contenido: string; categoria?: string; imagen_url?: string }

    if (!titulo || !contenido) return reply.code(400).send({ error: 'titulo y contenido son requeridos' })

    const { rows } = await pool.query(
      `INSERT INTO recurso_pac
         (clinica_id, profesional_id, titulo, resumen, contenido, categoria, imagen_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [clinicaId, proId, titulo, resumen ?? null, contenido, categoria ?? 'otro', imagen_url ?? null]
    )
    return reply.code(201).send(rows[0])
  })

  // GET /api/profesional/recursos/:id
  app.get('/api/profesional/recursos/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId
    const { id } = req.params as { id: string }

    const { rows: [recurso] } = await pool.query(
      `SELECT r.*,
              (SELECT COUNT(*) FROM recurso_pac_lectura l WHERE l.recurso_id = r.id) AS lecturas
       FROM recurso_pac r
       WHERE r.id = $1 AND r.clinica_id = $2 AND r.activo = true`,
      [id, clinicaId]
    )
    if (!recurso) return reply.code(404).send({ error: 'Recurso no encontrado' })
    return recurso
  })

  // PATCH /api/profesional/recursos/:id
  app.patch('/api/profesional/recursos/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId
    const { id } = req.params as { id: string }
    const updates = req.body as Partial<{
      titulo: string; resumen: string; contenido: string;
      categoria: string; imagen_url: string
    }>

    const allowed = ['titulo', 'resumen', 'contenido', 'categoria', 'imagen_url']
    const setClauses = Object.keys(updates)
      .filter(k => allowed.includes(k))
      .map((k, i) => `${k} = $${i + 3}`)
    if (!setClauses.length) return reply.code(400).send({ error: 'Sin cambios válidos' })

    const values = Object.keys(updates)
      .filter(k => allowed.includes(k))
      .map(k => (updates as any)[k])

    const { rows } = await pool.query(
      `UPDATE recurso_pac
       SET ${setClauses.join(', ')}, updated_at = now()
       WHERE id = $1 AND clinica_id = $2 AND activo = true
       RETURNING *`,
      [id, clinicaId, ...values]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Recurso no encontrado' })
    return rows[0]
  })

  // POST /api/profesional/recursos/:id/publicar
  app.post('/api/profesional/recursos/:id/publicar', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId
    const { id } = req.params as { id: string }

    const { rows } = await pool.query(
      `UPDATE recurso_pac
       SET publicado = true, publicado_en = COALESCE(publicado_en, now()), updated_at = now()
       WHERE id = $1 AND clinica_id = $2 AND activo = true
       RETURNING *`,
      [id, clinicaId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Recurso no encontrado' })
    return rows[0]
  })

  // POST /api/profesional/recursos/:id/despublicar
  app.post('/api/profesional/recursos/:id/despublicar', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId
    const { id } = req.params as { id: string }

    const { rows } = await pool.query(
      `UPDATE recurso_pac SET publicado = false, updated_at = now()
       WHERE id = $1 AND clinica_id = $2 AND activo = true
       RETURNING *`,
      [id, clinicaId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Recurso no encontrado' })
    return rows[0]
  })

  // POST /api/profesional/recursos/:id/archivar  (soft-delete)
  app.post('/api/profesional/recursos/:id/archivar', { onRequest: [app.authenticate] }, async (req, reply) => {
    const clinicaId = (req as any).auth.tenantId
    const { id } = req.params as { id: string }

    const { rowCount } = await pool.query(
      `UPDATE recurso_pac SET activo = false, updated_at = now()
       WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    )
    if (!rowCount) return reply.code(404).send({ error: 'Recurso no encontrado' })
    return reply.code(204).send()
  })
}
```

Registrar en `apps/api/src/server.ts`:

```typescript
import { recursosProRoutes } from './profesional/recursos.js'
await app.register(recursosProRoutes, { pool })
```

---

## Paso 7 — Frontend web-patient: PAC-07 modo detallado en DiarioComidas

Editar `apps/web-patient/src/pages/DiarioComidas.tsx` para añadir el toggle y el buscador de alimentos.

### 7a — Hook de configuración

Crear `apps/web-patient/src/hooks/useConfiguracion.ts`:

```typescript
import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

export function useConfiguracion() {
  const [modoDetallado, setModoDetallado] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/api/paciente/configuracion')
      .then(r => r.json())
      .then(d => setModoDetallado(d.modo_diario === 'detallado'))
      .finally(() => setLoading(false))
  }, [])

  const toggleModo = async () => {
    const nuevo = modoDetallado ? 'simple' : 'detallado'
    setModoDetallado(!modoDetallado)
    await apiFetch('/api/paciente/configuracion', {
      method: 'PATCH',
      body: JSON.stringify({ modo_diario: nuevo }),
    })
  }

  return { modoDetallado, toggleModo, loading }
}
```

### 7b — Componente BuscadorAlimento

Crear `apps/web-patient/src/components/BuscadorAlimento.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api'

interface Alimento {
  id: string
  nombre: string
  kcal_por_100g: number | null
  proteina_por_100g: number | null
  carbs_por_100g: number | null
  grasas_por_100g: number | null
  porcion_tipica_g: number
  unidad_porcion: string
  categoria: string
}

interface Props {
  registroId: string
  onItemAdded: () => void
}

export function BuscadorAlimento({ registroId, onItemAdded }: Props) {
  const [query, setQuery] = useState('')
  const [resultados, setResultados] = useState<Alimento[]>([])
  const [seleccionado, setSeleccionado] = useState<Alimento | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [mostrarPersonalizado, setMostrarPersonalizado] = useState(false)
  const [nombrePersonalizado, setNombrePersonalizado] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (query.length < 2) { setResultados([]); return }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const r = await apiFetch(`/api/alimentos?q=${encodeURIComponent(query)}`)
      setResultados(await r.json())
    }, 300)
    return () => clearTimeout(timerRef.current)
  }, [query])

  const elegir = (a: Alimento) => {
    setSeleccionado(a)
    setCantidad(String(a.porcion_tipica_g))
    setQuery('')
    setResultados([])
    setMostrarPersonalizado(false)
  }

  const agregar = async () => {
    if (submitting) return
    const g = parseFloat(cantidad)
    if (!g || g <= 0) return

    setSubmitting(true)
    try {
      if (seleccionado) {
        await apiFetch(`/api/paciente/diario/${registroId}/items`, {
          method: 'POST',
          body: JSON.stringify({ alimento_id: seleccionado.id, cantidad_g: g }),
        })
      } else if (mostrarPersonalizado && nombrePersonalizado.trim()) {
        await apiFetch(`/api/paciente/diario/${registroId}/items`, {
          method: 'POST',
          body: JSON.stringify({ nombre_alimento: nombrePersonalizado.trim(), cantidad_g: g }),
        })
      }
      setSeleccionado(null)
      setCantidad('')
      setNombrePersonalizado('')
      setMostrarPersonalizado(false)
      onItemAdded()
    } finally {
      setSubmitting(false)
    }
  }

  // Preview de nutrientes calculados según cantidad
  const preview = seleccionado && parseFloat(cantidad) > 0 ? {
    kcal:     seleccionado.kcal_por_100g      != null ? +(seleccionado.kcal_por_100g      * parseFloat(cantidad) / 100).toFixed(1) : null,
    proteina: seleccionado.proteina_por_100g  != null ? +(seleccionado.proteina_por_100g  * parseFloat(cantidad) / 100).toFixed(1) : null,
    carbs:    seleccionado.carbs_por_100g     != null ? +(seleccionado.carbs_por_100g     * parseFloat(cantidad) / 100).toFixed(1) : null,
    grasas:   seleccionado.grasas_por_100g    != null ? +(seleccionado.grasas_por_100g    * parseFloat(cantidad) / 100).toFixed(1) : null,
  } : null

  return (
    <div className="space-y-2">
      {/* Búsqueda */}
      {!seleccionado && !mostrarPersonalizado && (
        <>
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar alimento…"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]
                         px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
            {resultados.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-lg border border-[var(--color-border)]
                             bg-[var(--color-bg)] shadow-lg max-h-52 overflow-y-auto">
                {resultados.map(a => (
                  <li key={a.id}>
                    <button
                      onClick={() => elegir(a)}
                      className="flex w-full items-center justify-between px-3 py-2 text-sm
                                 hover:bg-[var(--color-bg-alt)] text-left"
                    >
                      <span>{a.nombre}</span>
                      {a.kcal_por_100g != null && (
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {a.kcal_por_100g} kcal/100g
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            onClick={() => setMostrarPersonalizado(true)}
            className="text-xs text-[var(--color-primary)] underline"
          >
            + Agregar alimento personalizado
          </button>
        </>
      )}

      {/* Alimento personalizado */}
      {mostrarPersonalizado && !seleccionado && (
        <div className="space-y-2">
          <input
            type="text"
            value={nombrePersonalizado}
            onChange={e => setNombrePersonalizado(e.target.value)}
            placeholder="Nombre del alimento"
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]
                       px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
        </div>
      )}

      {/* Cantidad + preview + botón Agregar */}
      {(seleccionado || (mostrarPersonalizado && nombrePersonalizado.trim())) && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)] p-3 space-y-2">
          <p className="text-sm font-medium text-[var(--color-text)]">
            {seleccionado?.nombre ?? nombrePersonalizado}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              value={cantidad}
              onChange={e => setCantidad(e.target.value)}
              min="1"
              step="1"
              className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]
                         px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
            <span className="text-xs text-[var(--color-text-muted)]">g</span>
            <button
              onClick={() => { setSeleccionado(null); setMostrarPersonalizado(false); setNombrePersonalizado('') }}
              className="ml-auto text-xs text-[var(--color-text-muted)] underline"
            >
              Cambiar
            </button>
          </div>

          {/* Preview nutrientes */}
          {preview && (
            <div className="grid grid-cols-4 gap-1 text-center">
              {[
                { label: 'kcal', value: preview.kcal },
                { label: 'Prot', value: preview.proteina },
                { label: 'Carbs', value: preview.carbs },
                { label: 'Grasas', value: preview.grasas },
              ].map(({ label, value }) => (
                <div key={label} className="rounded bg-[var(--color-bg)] p-1">
                  <p className="text-xs font-medium text-[var(--color-primary)]">
                    {value ?? '—'}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">{label}</p>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={agregar}
            disabled={submitting}
            className="w-full rounded-lg bg-[var(--color-primary)] py-2 text-sm
                       font-medium text-white disabled:opacity-60"
          >
            {submitting ? 'Agregando…' : 'Agregar'}
          </button>
        </div>
      )}
    </div>
  )
}
```

### 7c — Componente ListaItems

Crear `apps/web-patient/src/components/ListaItems.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

interface Item {
  id: string
  nombre_alimento: string
  cantidad_g: number
  kcal: number | null
  proteina_g: number | null
  carbohidratos_g: number | null
  grasas_g: number | null
}

interface Props {
  registroId: string
  refresh: number   // incrementar para forzar recarga
}

export function ListaItems({ registroId, refresh }: Props) {
  const [items, setItems] = useState<Item[]>([])

  const cargar = useCallback(async () => {
    const r = await apiFetch(`/api/paciente/diario/${registroId}/items`)
    setItems(await r.json())
  }, [registroId])

  useEffect(() => { cargar() }, [cargar, refresh])

  const eliminar = async (itemId: string) => {
    await apiFetch(`/api/paciente/diario/${registroId}/items/${itemId}`, { method: 'DELETE' })
    setItems(prev => prev.filter(i => i.id !== itemId))
  }

  if (!items.length) return null

  return (
    <ul className="mt-2 space-y-1">
      {items.map(item => (
        <li key={item.id}
            className="flex items-center justify-between rounded-lg bg-[var(--color-bg-alt)] px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--color-text)]">
              {item.nombre_alimento}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {item.cantidad_g}g
              {item.kcal != null && ` · ${item.kcal} kcal`}
              {item.proteina_g != null && ` · P ${item.proteina_g}g`}
            </p>
          </div>
          <button
            onClick={() => eliminar(item.id)}
            className="ml-2 flex-shrink-0 rounded-full p-1 text-[var(--color-text-muted)]
                       hover:bg-[var(--color-danger-light)] hover:text-[var(--color-danger)]"
            aria-label="Eliminar ítem"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </li>
      ))}
    </ul>
  )
}
```

### 7d — Modificar DiarioComidas.tsx

En `apps/web-patient/src/pages/DiarioComidas.tsx`, añadir:

1. Import de los nuevos componentes y hook:
```typescript
import { useConfiguracion } from '../hooks/useConfiguracion'
import { BuscadorAlimento } from '../components/BuscadorAlimento'
import { ListaItems } from '../components/ListaItems'
```

2. Dentro del componente, añadir el hook y estado de refresh:
```typescript
const { modoDetallado, toggleModo } = useConfiguracion()
const [itemsRefresh, setItemsRefresh] = useState<Record<string, number>>({})
const triggerRefresh = (registroId: string) =>
  setItemsRefresh(prev => ({ ...prev, [registroId]: (prev[registroId] ?? 0) + 1 }))
```

3. En la cabecera del diario (encima de los slots), añadir el toggle:
```tsx
<div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
  <span className="text-sm font-medium text-[var(--color-text)]">Modo detallado</span>
  <button
    role="switch"
    aria-checked={modoDetallado}
    onClick={toggleModo}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                ${modoDetallado ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`}
  >
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
                      ${modoDetallado ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>
</div>
```

4. Dentro de cada slot (cuando el slot tiene un `registro.id`), añadir al SlotBottomSheet o al slot expandido:
```tsx
{modoDetallado && registro?.id && (
  <div className="mt-3 border-t border-[var(--color-border)] pt-3">
    <BuscadorAlimento
      registroId={registro.id}
      onItemAdded={() => triggerRefresh(registro.id)}
    />
    <ListaItems
      registroId={registro.id}
      refresh={itemsRefresh[registro.id] ?? 0}
    />
  </div>
)}
```

5. En modo detallado, los totales de kcal/macros del slot se leen del `registro_comida` (que ya se recalcula automáticamente via `recalcularTotalesRegistro` en la API) — el fetch existente de registros del día ya devuelve kcal/macros actualizados.

---

## Paso 8 — Frontend web-patient: PAC-08 tab Biblioteca

### 8a — Añadir tab "Biblioteca" al NavBar inferior

Editar `apps/web-patient/src/components/NavBar.tsx`. La barra inferior pasa de 3 a 4 ítems:

```
Inicio | Mis citas | Mis registros | Biblioteca
```

Añadir el ítem con icono de libro:

```tsx
{
  to: '/biblioteca',
  label: 'Biblioteca',
  icon: (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M4 4h5a2 2 0 012 2v11a1.5 1.5 0 01-3 0V6H4V4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M11 4h5a2 2 0 012 2v11a1.5 1.5 0 01-3 0V6h-4V4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
}
```

### 8b — Página BibliotecaPage

Crear `apps/web-patient/src/pages/BibliotecaPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'

const CATEGORIAS = [
  { value: '', label: 'Todo' },
  { value: 'nutricion',  label: 'Nutrición' },
  { value: 'ejercicio',  label: 'Ejercicio' },
  { value: 'habitos',    label: 'Hábitos' },
  { value: 'recetas',    label: 'Recetas' },
  { value: 'otro',       label: 'Otro' },
]

interface Recurso {
  id: string
  titulo: string
  resumen: string | null
  categoria: string
  imagen_url: string | null
  publicado_en: string
  leido: boolean
  autor: string
}

export default function BibliotecaPage() {
  const navigate = useNavigate()
  const [categoria, setCategoria] = useState('')
  const [pagina, setPagina] = useState(1)
  const [recursos, setRecursos] = useState<Recurso[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ pagina: String(pagina) })
      if (categoria) params.set('categoria', categoria)
      const r = await apiFetch(`/api/paciente/recursos?${params}`)
      const data = await r.json()
      setRecursos(data.recursos)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }, [categoria, pagina])

  useEffect(() => { cargar() }, [cargar])

  const limite = 12

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[var(--color-bg)] border-b border-[var(--color-border)] px-4 py-3">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">Biblioteca</h1>
      </header>

      {/* Filtros por categoría */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
        {CATEGORIAS.map(c => (
          <button
            key={c.value}
            onClick={() => { setCategoria(c.value); setPagina(1) }}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors
                        ${categoria === c.value
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'bg-[var(--color-bg-alt)] text-[var(--color-text-muted)]'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Lista de recursos */}
      <div className="px-4 space-y-3">
        {loading && (
          <div className="flex justify-center py-12">
            <span className="text-sm text-[var(--color-text-muted)]">Cargando…</span>
          </div>
        )}

        {!loading && !recursos.length && (
          <div className="flex flex-col items-center py-16 gap-3">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="8" y="8" width="32" height="32" rx="4"
                    stroke="var(--color-border)" strokeWidth="2"/>
              <path d="M16 18h16M16 24h10" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <p className="text-sm text-[var(--color-text-muted)] text-center">
              No hay recursos disponibles aún.<br/>Tu nutriólogo publicará artículos aquí.
            </p>
          </div>
        )}

        {recursos.map(r => (
          <button
            key={r.id}
            onClick={() => navigate(`/biblioteca/${r.id}`)}
            className="w-full text-left rounded-xl border border-[var(--color-border)]
                       bg-[var(--color-bg)] overflow-hidden shadow-sm hover:shadow-md transition-shadow"
          >
            {/* Imagen (si existe) */}
            {r.imagen_url && (
              <img
                src={r.imagen_url}
                alt={r.titulo}
                className="h-36 w-full object-cover"
                onError={e => (e.currentTarget.style.display = 'none')}
              />
            )}
            <div className="p-3 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--color-text)] leading-snug">
                  {r.titulo}
                </p>
                {!r.leido && (
                  <span className="flex-shrink-0 h-2 w-2 rounded-full bg-[var(--color-primary)] mt-1" />
                )}
              </div>
              {r.resumen && (
                <p className="text-xs text-[var(--color-text-muted)] line-clamp-2">{r.resumen}</p>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {r.autor} · {new Date(r.publicado_en).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                </span>
                <CategoriaChip categoria={r.categoria} />
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Paginación */}
      {total > limite && (
        <div className="flex justify-center gap-4 mt-6 px-4">
          <button
            disabled={pagina === 1}
            onClick={() => setPagina(p => p - 1)}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm
                       disabled:opacity-40 text-[var(--color-text)]"
          >
            ← Anterior
          </button>
          <span className="py-2 text-sm text-[var(--color-text-muted)]">
            {pagina} / {Math.ceil(total / limite)}
          </span>
          <button
            disabled={pagina >= Math.ceil(total / limite)}
            onClick={() => setPagina(p => p + 1)}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm
                       disabled:opacity-40 text-[var(--color-text)]"
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  )
}

function CategoriaChip({ categoria }: { categoria: string }) {
  const LABELS: Record<string, string> = {
    nutricion: 'Nutrición', ejercicio: 'Ejercicio',
    habitos: 'Hábitos', recetas: 'Recetas', otro: 'General',
  }
  return (
    <span className="rounded-full bg-[var(--color-bg-alt)] px-2 py-0.5
                     text-[10px] font-medium text-[var(--color-text-muted)]">
      {LABELS[categoria] ?? categoria}
    </span>
  )
}
```

### 8c — Página RecursoDetallePage

Crear `apps/web-patient/src/pages/RecursoDetallePage.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'

interface Recurso {
  id: string
  titulo: string
  resumen: string | null
  contenido: string
  categoria: string
  imagen_url: string | null
  publicado_en: string
  autor: string
}

export default function RecursoDetallePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [recurso, setRecurso] = useState<Recurso | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    apiFetch(`/api/paciente/recursos/${id}`)
      .then(r => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then(setRecurso)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <span className="text-sm text-[var(--color-text-muted)]">Cargando…</span>
    </div>
  )

  if (error || !recurso) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3 px-4">
      <p className="text-sm text-[var(--color-text-muted)]">Recurso no disponible.</p>
      <button onClick={() => navigate('/biblioteca')}
              className="text-sm text-[var(--color-primary)] underline">
        Volver a Biblioteca
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24">
      {/* Back */}
      <header className="sticky top-0 z-10 bg-[var(--color-bg)] border-b border-[var(--color-border)] px-4 py-3">
        <button
          onClick={() => navigate('/biblioteca')}
          className="flex items-center gap-1.5 text-sm text-[var(--color-primary)]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Biblioteca
        </button>
      </header>

      {/* Imagen */}
      {recurso.imagen_url && (
        <img
          src={recurso.imagen_url}
          alt={recurso.titulo}
          className="h-48 w-full object-cover"
          onError={e => (e.currentTarget.style.display = 'none')}
        />
      )}

      <div className="px-4 py-5 space-y-4">
        {/* Título y meta */}
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-[var(--color-text)] leading-tight">{recurso.titulo}</h1>
          <p className="text-xs text-[var(--color-text-muted)]">
            {recurso.autor} · {new Date(recurso.publicado_en).toLocaleDateString('es-MX', {
              day: 'numeric', month: 'long', year: 'numeric'
            })}
          </p>
        </div>

        {/* Resumen */}
        {recurso.resumen && (
          <p className="text-sm italic text-[var(--color-text-muted)] border-l-4
                        border-[var(--color-primary-light)] pl-3 leading-relaxed">
            {recurso.resumen}
          </p>
        )}

        {/* Contenido — renderizar saltos de línea como párrafos */}
        <div className="space-y-3">
          {recurso.contenido.split('\n\n').filter(Boolean).map((parrafo, i) => (
            <p key={i} className="text-sm text-[var(--color-text)] leading-relaxed">
              {parrafo}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}
```

### 8d — Registrar rutas en el router

En `apps/web-patient/src/App.tsx` (o el archivo de rutas correspondiente), añadir:

```tsx
import BibliotecaPage    from './pages/BibliotecaPage'
import RecursoDetallePage from './pages/RecursoDetallePage'
// ...
<Route path="/biblioteca"     element={<BibliotecaPage />} />
<Route path="/biblioteca/:id" element={<RecursoDetallePage />} />
```

---

## Paso 9 — Frontend web-professional: sección Recursos

### 9a — Ruta /recursos en web-professional

Crear `apps/web-professional/src/pages/RecursosPage.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'
import { ModalRecurso } from '../components/recursos/ModalRecurso'

interface Recurso {
  id: string
  titulo: string
  categoria: string
  publicado: boolean
  publicado_en: string | null
  updated_at: string
  lecturas: number
}

export default function RecursosPage() {
  const [recursos, setRecursos] = useState<Recurso[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editando, setEditando] = useState<Recurso | null>(null)

  const cargar = async () => {
    setLoading(true)
    const r = await apiFetch('/api/profesional/recursos')
    setRecursos(await r.json())
    setLoading(false)
  }

  useEffect(() => { cargar() }, [])

  const publicar = async (id: string, publicado: boolean) => {
    const endpoint = publicado ? 'despublicar' : 'publicar'
    await apiFetch(`/api/profesional/recursos/${id}/${endpoint}`, { method: 'POST' })
    cargar()
  }

  const archivar = async (id: string) => {
    if (!confirm('¿Archivar este recurso? Los pacientes dejarán de verlo.')) return
    await apiFetch(`/api/profesional/recursos/${id}/archivar`, { method: 'POST' })
    cargar()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Biblioteca de recursos</h1>
        <button
          onClick={() => { setEditando(null); setModalOpen(true) }}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white"
        >
          + Nuevo artículo
        </button>
      </div>

      {/* Tabla de recursos */}
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
        {loading ? (
          <div className="flex justify-center py-12">
            <span className="text-sm text-[var(--color-text-muted)]">Cargando…</span>
          </div>
        ) : recursos.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-2">
            <p className="text-sm text-[var(--color-text-muted)]">
              Aún no hay artículos. Crea el primero para empezar a publicar contenido a tus pacientes.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-bg-alt)]">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-[var(--color-text-muted)]">Título</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--color-text-muted)]">Categoría</th>
                <th className="px-4 py-3 text-center font-medium text-[var(--color-text-muted)]">Estado</th>
                <th className="px-4 py-3 text-center font-medium text-[var(--color-text-muted)]">Lecturas</th>
                <th className="px-4 py-3 text-right font-medium text-[var(--color-text-muted)]">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {recursos.map(r => (
                <tr key={r.id} className="hover:bg-[var(--color-bg-alt)] transition-colors">
                  <td className="px-4 py-3 font-medium text-[var(--color-text)]">{r.titulo}</td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)] capitalize">{r.categoria}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium
                                     ${r.publicado
                                       ? 'bg-[var(--color-success-bg)] text-[var(--color-success)]'
                                       : 'bg-[var(--color-bg-alt)] text-[var(--color-text-muted)]'}`}>
                      {r.publicado ? 'Publicado' : 'Borrador'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-[var(--color-text-muted)]">{r.lecturas}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => { setEditando(r); setModalOpen(true) }}
                        className="text-xs text-[var(--color-primary)] hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => publicar(r.id, r.publicado)}
                        className="text-xs text-[var(--color-text-muted)] hover:underline"
                      >
                        {r.publicado ? 'Despublicar' : 'Publicar'}
                      </button>
                      <button
                        onClick={() => archivar(r.id)}
                        className="text-xs text-[var(--color-danger)] hover:underline"
                      >
                        Archivar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal crear/editar */}
      {modalOpen && (
        <ModalRecurso
          recurso={editando}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); cargar() }}
        />
      )}
    </div>
  )
}
```

### 9b — Modal ModalRecurso

Crear `apps/web-professional/src/components/recursos/ModalRecurso.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { apiFetch } from '../../lib/api'

const CATEGORIAS = [
  { value: 'nutricion', label: 'Nutrición' },
  { value: 'ejercicio', label: 'Ejercicio' },
  { value: 'habitos',   label: 'Hábitos' },
  { value: 'recetas',   label: 'Recetas' },
  { value: 'otro',      label: 'Otro' },
]

interface Props {
  recurso: { id: string; titulo: string; categoria: string } | null
  onClose: () => void
  onSaved: () => void
}

export function ModalRecurso({ recurso, onClose, onSaved }: Props) {
  const [titulo, setTitulo] = useState('')
  const [resumen, setResumen] = useState('')
  const [contenido, setContenido] = useState('')
  const [categoria, setCategoria] = useState('otro')
  const [imagenUrl, setImagenUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (recurso) {
      // Si estamos editando, cargar el recurso completo
      apiFetch(`/api/profesional/recursos/${recurso.id}`)
        .then(r => r.json())
        .then(d => {
          setTitulo(d.titulo ?? '')
          setResumen(d.resumen ?? '')
          setContenido(d.contenido ?? '')
          setCategoria(d.categoria ?? 'otro')
          setImagenUrl(d.imagen_url ?? '')
        })
    }
  }, [recurso])

  const guardar = async () => {
    if (!titulo.trim() || !contenido.trim()) {
      setError('El título y el contenido son obligatorios.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const body = {
        titulo: titulo.trim(),
        resumen: resumen.trim() || undefined,
        contenido: contenido.trim(),
        categoria,
        imagen_url: imagenUrl.trim() || undefined,
      }

      if (recurso) {
        await apiFetch(`/api/profesional/recursos/${recurso.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      } else {
        await apiFetch('/api/profesional/recursos', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      }
      onSaved()
    } catch {
      setError('Error al guardar. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-[var(--color-bg)] shadow-xl
                      max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {recurso ? 'Editar artículo' : 'Nuevo artículo'}
          </h2>
          <button onClick={onClose}
                  className="rounded-full p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-alt)]">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Título */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Título *</label>
            <input
              type="text" value={titulo} onChange={e => setTitulo(e.target.value)}
              maxLength={200}
              placeholder="Título del artículo"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]
                         px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>

          {/* Categoría */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Categoría</label>
            <select
              value={categoria} onChange={e => setCategoria(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]
                         px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {/* Resumen */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">
              Resumen <span className="text-[var(--color-text-muted)] font-normal">(opcional, hasta 500 car.)</span>
            </label>
            <textarea
              value={resumen} onChange={e => setResumen(e.target.value)}
              rows={2} maxLength={500}
              placeholder="Breve descripción que verá el paciente en la lista…"
              className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]
                         px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>

          {/* Contenido */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">
              Contenido * <span className="font-normal">(separa párrafos con línea en blanco)</span>
            </label>
            <textarea
              value={contenido} onChange={e => setContenido(e.target.value)}
              rows={10}
              placeholder="Escribe el artículo aquí…"
              className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]
                         px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>

          {/* URL de imagen */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">
              URL de imagen de portada <span className="font-normal">(opcional)</span>
            </label>
            <input
              type="url" value={imagenUrl} onChange={e => setImagenUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]
                         px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>

          {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t border-[var(--color-border)] px-6 py-4">
          <button onClick={onClose}
                  className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm
                             text-[var(--color-text-muted)] hover:bg-[var(--color-bg-alt)]">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={saving}
            className="rounded-lg bg-[var(--color-primary)] px-5 py-2 text-sm font-medium
                       text-white disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar borrador'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

### 9c — Añadir ruta en el router de web-professional

En `apps/web-professional/src/App.tsx`:

```tsx
import RecursosPage from './pages/RecursosPage'
// ...
<Route path="/recursos" element={<RecursosPage />} />
```

Añadir el ítem "Recursos" en el menú lateral de web-professional (Sidebar):

```tsx
{
  to: '/recursos',
  label: 'Recursos',
  icon: <IconBiblioteca />,  // SVG libro similar al del patient
}
```

---

## Paso 10 — Verificación

Una vez que Claude Code termine todos los pasos, ejecutar:

```bash
# 1. Verificar que las migraciones se aplicaron
psql $DATABASE_URL -c "
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('alimento_catalogo','registro_comida_item','configuracion_paciente','recurso_pac','recurso_pac_lectura')
  ORDER BY table_name;"

# 2. Verificar el seed de alimentos
psql $DATABASE_URL -c "SELECT COUNT(*) AS total_alimentos FROM alimento_catalogo WHERE clinica_id IS NULL;"
# Debe devolver 35

# 3. TypeScript sin errores de compilación
cd apps/api && npx tsc --noEmit
cd apps/web-patient && npx tsc --noEmit
cd apps/web-professional && npx tsc --noEmit

# 4. Smoke test endpoints PAC-07
# (reemplazar TOKEN con un JWT de paciente válido)
curl -H "Authorization: Bearer $PATIENT_TOKEN" http://localhost:4001/api/alimentos?q=pollo
curl -H "Authorization: Bearer $PATIENT_TOKEN" http://localhost:4001/api/paciente/configuracion

# 5. Smoke test endpoints PAC-08
curl -H "Authorization: Bearer $PATIENT_TOKEN" http://localhost:4001/api/paciente/recursos
curl -H "Authorization: Bearer $PRO_TOKEN" http://localhost:4001/api/profesional/recursos

# 6. Verificar que web-patient compila y sirve en puerto 5175
curl -s http://localhost:5175 | grep -c "biblioteca"
```

Si algún `tsc --noEmit` falla, corregir los errores de tipos antes de dar por finalizado.

---

## Resumen de cambios

| Capa | Archivo | Cambio |
|------|---------|--------|
| Migración | `025_alimento_catalogo.sql` | Tablas: `alimento_catalogo`, `registro_comida_item`, `configuracion_paciente` |
| Migración | `026_recurso_pac.sql` | Tablas: `recurso_pac`, `recurso_pac_lectura` |
| Seed | `025_alimentos_seed.sql` | 35 alimentos globales (solo si tabla vacía) |
| API | `src/paciente/alimentos.ts` | `GET /api/alimentos`, config del paciente, ítems por registro |
| API | `src/paciente/recursos.ts` | Listado y detalle de recursos para paciente |
| API | `src/profesional/recursos.ts` | CRUD completo + publicar/despublicar para profesional |
| PWA | `hooks/useConfiguracion.ts` | Leer/escribir modo simple/detallado |
| PWA | `components/BuscadorAlimento.tsx` | Buscador con preview de macros |
| PWA | `components/ListaItems.tsx` | Lista de ítems con soft-delete inline |
| PWA | `pages/DiarioComidas.tsx` | Toggle modo detallado + integración BuscadorAlimento/ListaItems |
| PWA | `pages/BibliotecaPage.tsx` | Listado paginado de recursos con filtros |
| PWA | `pages/RecursoDetallePage.tsx` | Detalle y marcado automático como leído |
| PWA | `components/NavBar.tsx` | 4to tab "Biblioteca" |
| Pro | `pages/RecursosPage.tsx` | Tabla de recursos con publicar/archivar |
| Pro | `components/recursos/ModalRecurso.tsx` | Crear/editar artículos |
| Pro | `App.tsx` | Rutas `/recursos` |
| Pro | Sidebar | Ítem "Recursos" |
