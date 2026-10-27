# R56 — Poblar catálogo con datos USDA y limpiar tablas duplicadas

## Contexto

La migración 063 creó `alimento` (4 608 filas) y `alimento_porcion` (8 276 filas) como tablas paralelas.
El sistema de búsqueda ya funciona con `alimento_catalogo` + `alimento_unidad`, y la UI (`BuscarAlimentoSheet`) llama a `GET /api/paciente/alimentos?q=`.
La solución es migrar los datos USDA al catálogo existente y eliminar las tablas duplicadas.

## 1. Relevar antes de tocar

Leer el schema completo de `alimento_catalogo` y `alimento_unidad` (columnas, tipos, restricciones) y el endpoint `GET /api/paciente/alimentos` (apps/api/src/routes/alimentos.ts línea 177) para conocer exactamente qué columnas devuelve. No modificar nada en este paso.

## 2. Migración nueva — `apps/api/migrations/064_poblar_catalogo_usda.sql`

### 2a. Insertar alimentos USDA en `alimento_catalogo`

- `clinica_id = NULL` (global, disponible para todas las clínicas)
- `nombre` = columna `nombre` de `alimento` (ya está en español)
- `sinonimos` = ARRAY[`nombre_en`] (el nombre en inglés como sinónimo, mejora la búsqueda)
- Macros: mapear `kcal`, `proteina_g`, `carbs_g`, `grasa_g`, `fibra_g` a las columnas correspondientes de `alimento_catalogo` (usar los nombres exactos que encontraste en el paso 1)
- Guardar `fdc_id` en alguna columna de referencia si `alimento_catalogo` la tiene; si no, ignorar
- `ON CONFLICT` adecuado según el índice único de `alimento_catalogo`

### 2b. Insertar porciones en `alimento_unidad`

- Unir `alimento_porcion` → `alimento` → `alimento_catalogo` (por `fdc_id` o por nombre)
- Mapear `etiqueta` y `gramos` a las columnas de `alimento_unidad`
- Solo insertar donde exista el alimento correspondiente en `alimento_catalogo`

### 2c. Eliminar tablas duplicadas

```sql
drop table if exists alimento_porcion;
drop table if exists alimento;
```

## 3. No tocar código

El endpoint y la UI ya funcionan. No modificar `alimentos.ts`, `BuscarAlimentoSheet.tsx` ni ningún componente — solo ejecutar la migración y verificar que el endpoint devuelve resultados del catálogo ampliado.

## 4. Verificación

Después de aplicar la migración en dev, ejecutar:

```sql
select count(*) from alimento_catalogo where clinica_id is null;
-- debe ser >= 4608 (más los 50 que ya había)

select count(*) from alimento_unidad;
-- debe incluir las porciones USDA
```

Y probar el endpoint:
```
GET /api/paciente/alimentos?q=pollo
```
Debe devolver resultados con macros.

## 5. Schema_migrations en producción

En producción `alimento` y `alimento_porcion` ya existen y tienen datos. Después de hacer el deploy de esta migración, el DROP TABLE las eliminará correctamente porque `064` corre después de `063`.

**No crear** archivos `.md` ni README.
