# R51 — Ajustes al módulo de laboratorio

## Contexto

R49/R50 ya están en producción. Este prompt agrupa tres ajustes menores al módulo de laboratorio:

1. Eliminar el tab **Dashboards** de la valoración (reemplazado por Analítica en Laboratorios)
2. Agregar botón de **eliminar estudio** en la lista de estudios
3. Permitir **ingresar rangos de referencia** cuando la fila es una entrada libre (sin catálogo)

---

## PASO 0 — Leer antes de tocar

Antes de escribir cualquier código, leer:

```
apps/web-professional/src/components/eval/PacienteEvaluacion.tsx   (o el componente raíz de la valoración — donde viven los tabs Antropometría / Laboratorios / Dashboards / Clínico / Dietético / Prescripción)
apps/web-professional/src/components/eval/DashboardBioquimica.tsx  (el componente que se elimina)
apps/web-professional/src/components/eval/PanelBioquimica.tsx       (donde vive la lista de estudios)
apps/web-professional/src/components/LaboratorioModal.tsx           (el formulario de carga)
apps/api/src/routes/laboratorios.ts                                 (rutas actuales)
apps/api/migrations/                                                (el último número de migración para la nueva)
```

---

## Ajuste 1 — Eliminar el tab Dashboards

En el componente raíz de la valoración (probablemente `PacienteEvaluacion.tsx`):

- Eliminar la entrada `Dashboards` del array de tabs.
- Eliminar la importación de `DashboardBioquimica`.
- Eliminar el `case`/bloque condicional que renderiza `<DashboardBioquimica>`.
- NO borrar el archivo `DashboardBioquimica.tsx` todavía — solo desconectarlo. Agregar al inicio del archivo un comentario:
  ```tsx
  // DEPRECATED — reemplazado por PanelAnalitica (R50). Eliminar cuando se confirme que no hay referencias.
  ```

---

## Ajuste 2 — Eliminar estudio de laboratorio

### 2a. Migración

No se necesita migración nueva si `lab_resultado` ya tiene `ON DELETE CASCADE` hacia `estudio_laboratorio`. Verificarlo en la migración existente. Si no tiene CASCADE, agregar una migración que lo corrija:

```sql
-- solo si hace falta
ALTER TABLE lab_resultado
  DROP CONSTRAINT lab_resultado_estudio_id_fkey,
  ADD CONSTRAINT lab_resultado_estudio_id_fkey
    FOREIGN KEY (estudio_id) REFERENCES estudio_laboratorio(id) ON DELETE CASCADE;
```

### 2b. Endpoint

```
DELETE /api/pacientes/:pacienteId/laboratorios/:estudioId
```

- Verificar que el estudio pertenece al paciente antes de borrar (anti-IDOR).
- Devolver `204 No Content` si se eliminó.
- Devolver `404` si no existe o no pertenece al paciente.
- No hace falta soft-delete; es borrado físico.

### 2c. Frontend — botón en la lista de estudios

En `PanelBioquimica.tsx`, dentro de la pestaña **Estudios**, cada fila de estudio debe tener un botón de eliminar (ícono de basura o similar). Comportamiento:

1. Clic en el botón abre un diálogo de confirmación inline (no alert del navegador): `"¿Eliminar este estudio? Esta acción no se puede deshacer."` con botones **Cancelar** y **Eliminar**.
2. Al confirmar, llama al endpoint DELETE.
3. En caso de éxito, refresca la lista de estudios (o lo elimina del estado local sin refetch).
4. En caso de error, muestra un mensaje de error breve.

El botón de eliminar debe ser discreto (icono pequeño, color gris que se vuelve rojo en hover) para evitar clics accidentales.

---

## Ajuste 3 — Rangos de referencia en entradas libres

### 3a. Migración

Agregar dos columnas a `lab_resultado`:

```sql
-- migrations/0XX_libre_rangos.sql
ALTER TABLE lab_resultado
  ADD COLUMN ref_min_libre NUMERIC(10,4),
  ADD COLUMN ref_max_libre NUMERIC(10,4);

COMMENT ON COLUMN lab_resultado.ref_min_libre IS 'Rango mínimo ingresado manualmente para entradas libres (sin código de catálogo)';
COMMENT ON COLUMN lab_resultado.ref_max_libre IS 'Rango máximo ingresado manualmente para entradas libres (sin código de catálogo)';
```

El número de migración debe ser el consecutivo al último que exista en `apps/api/migrations/`.

### 3b. Endpoint POST — aceptar los campos nuevos

En `routes/laboratorios.ts`, el POST de guardado de estudio ya acepta filas libres con `nombre_libre` + `valor_texto`. Extender para que también acepte `ref_min_libre` y `ref_max_libre` (ambos opcionales, numéricos):

```typescript
// En el tipo/validación de cada fila libre:
{
  nombre_libre: string;
  valor_texto: string;
  ref_min_libre?: number | null;
  ref_max_libre?: number | null;
}
```

Insertar los valores en la tabla `lab_resultado` cuando vengan.

### 3c. Endpoint GET de detalle — devolver los campos

El endpoint que devuelve el detalle de un estudio (la ruta que usa `PanelBioquimica` para mostrar los resultados) debe incluir `ref_min_libre` y `ref_max_libre` en la respuesta para las filas libres.

### 3d. Frontend — `LaboratorioModal.tsx`

En las filas de tipo **entrada libre** (`esLibre = true`), agregar dos campos opcionales debajo del campo de valor:

```
[ Nombre del analito    ] [ Valor ]
[ Ref. mín (opcional)  ] [ Ref. máx (opcional) ]
```

- Los campos de referencia son numéricos, opcionales, con placeholder `"mín"` / `"máx"`.
- Solo aparecen en filas libres; las filas del catálogo ya tienen sus rangos en la base.
- En la interfaz de visualización del estudio (la vista de detalle dentro de Estudios), mostrar la referencia igual que se muestra para los analitos del catálogo: `refMin – refMax unidad` o `≤ refMax` o `≥ refMin`.

---

## Verificación

1. El tab Dashboards ya no aparece en la valoración; el tab Analítica sigue visible bajo Laboratorios.
2. En la lista de estudios, el botón de eliminar aparece por fila; al confirmar, el estudio desaparece sin recargar la página.
3. Al agregar una fila libre en el formulario de laboratorio, los campos Ref. mín / Ref. máx aparecen y se pueden completar. Al guardar, los valores quedan en la base. Al ver el detalle del estudio, la referencia se muestra correctamente.
4. Las filas del catálogo (cuantitativas y cualitativas) no muestran los campos de referencia libre.

---

## Rama y commit

Trabajar en una rama nueva: `r51-ajustes-lab`.

```bash
git checkout -b r51-ajustes-lab
```

Un solo commit al terminar:

```
feat(r51): eliminar tab Dashboards, borrar estudio y rangos en entradas libres
```

```bash
git push origin r51-ajustes-lab
```
