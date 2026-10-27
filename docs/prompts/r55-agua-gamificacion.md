# R55 — Registro de agua con botella animada

**Contexto:** `conclusion_valoracion` es la tabla de prescripción; está definida en `018_eval_conclusion.sql` y extendida con `ALTER TABLE` en migraciones posteriores (025, 040, 042, 046). La gamificación va en carpetas separadas.

---

## 1. Migración nueva — `apps/api/migrations/057_meta_agua.sql`

```sql
alter table conclusion_valoracion
  add column if not exists meta_agua_ml integer check (meta_agua_ml > 0);

create table if not exists registro_agua (
  id          uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references paciente(id),
  clinica_id  uuid not null references clinica(id),
  fecha       date not null default current_date,
  ml_total    integer not null default 0 check (ml_total >= 0),
  updated_at  timestamptz not null default now(),
  unique (paciente_id, clinica_id, fecha)
);
create index on registro_agua (paciente_id, clinica_id, fecha desc);
```

---

## 2. API profesional — `apps/api/src/routes/conclusion.ts`

Incluir `meta_agua_ml` en los `CAMPOS` del SELECT y en el INSERT/UPDATE de la conclusión. Seguir exactamente el mismo patrón que `peso_objetivo`.

---

## 3. API gamificación paciente — nuevo archivo `apps/api/src/routes/gamificacion/agua.ts`

- `GET /api/gamificacion/agua/hoy` → devuelve `{ meta_ml, registrado_hoy_ml, fecha }`. La meta viene del `meta_agua_ml` de la última `conclusion_valoracion` del paciente (la misma query que usa `paciente-registros.ts` línea 128). Si no hay meta devuelve `meta_ml: null`.
- `POST /api/gamificacion/agua/registro` body `{ ml: number }` → hace UPSERT en `registro_agua` sumando los ml al día de hoy (`ml_total = ml_total + $ml`), devuelve el registro actualizado. Validar que `ml > 0` y `ml <= 2000` por llamada.
- Registrar las rutas en el servidor principal igual que las demás rutas.

---

## 4. App profesional — `FormConclusion.tsx`

Agregar un campo numérico **"Agua recomendada (ml/día)"** que lee y guarda `meta_agua_ml`. Ponerlo en la sección de metas, junto a `peso_objetivo`. Placeholder `"ej. 2000"`. Mínimo 500, máximo 5000.

---

## 5. App paciente — nueva carpeta `apps/web-patient/src/gamification/agua/`

**`useAgua.ts`** — hook que llama a `GET /api/gamificacion/agua/hoy` al montar, expone `{ meta, registrado, pct, registrarMl, cargando }`. `registrarMl(ml)` llama al POST y actualiza el estado local sumando los ml.

**`BotellaAnimada.tsx`** — componente SVG de una botella de agua que se llena según `pct` (0–100). La parte llena sube con `transition: height 0.6s ease`. Color del agua: `#38bdf8` (celeste). Botones rápidos: +250 ml, +500 ml, +750 ml. Mostrar `registrado ml / meta ml` en texto debajo. Si `meta` es null, mostrar "Tu nutricionista aún no definió tu meta de agua".

Integrar `BotellaAnimada` en la pantalla principal del paciente (la que ya existe; relevá cuál es antes de tocarla).

---

**No crear** archivos `.md` ni README.
