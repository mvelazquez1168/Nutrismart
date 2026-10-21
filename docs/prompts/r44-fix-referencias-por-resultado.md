# R44 — Fix: referencias de laboratorio tomadas del PDF por resultado

Crea la rama `r44-fix-referencias-lab` desde `main` y aplica los siguientes cambios.

**Contexto del problema:** Cuando el profesional sube un PDF de laboratorio el sistema extrae los valores correctamente (R43), pero muestra "Sin referencia" en todos los biomarcadores porque la tabla `biomarcador_rango` del catálogo está vacía. La solución es extraer también los rangos de referencia que el propio PDF declara y guardarlos junto al resultado en `lab_resultado`. Así cada resultado lleva sus propias referencias, independientemente del catálogo global.

---

## Paso 0 — Pull de main

```
git checkout main && git pull origin main
git checkout -b r44-fix-referencias-lab
```

---

## Bloque 1 — Migración SQL

### Archivo: `apps/api/src/db/migrations/` (usa el siguiente número libre)

Crear archivo `NNN_lab_resultado_referencias.sql`:

```sql
-- R44: referencias de rango por resultado (tomadas del PDF o CSV del estudio)
alter table lab_resultado
  add column if not exists ref_minimo numeric,
  add column if not exists ref_maximo numeric;

comment on column lab_resultado.ref_minimo is
  'Límite inferior declarado por el laboratorio emisor. Tiene prioridad sobre biomarcador_rango al calcular estado.';
comment on column lab_resultado.ref_maximo is
  'Límite superior declarado por el laboratorio emisor. Tiene prioridad sobre biomarcador_rango al calcular estado.';
```

---

## Bloque 2 — Extractor PDF

### Archivo: `apps/api/src/laboratorios/pdf.ts`

Leer el archivo completo. Localizar el prompt de sistema que envía a la IA.

**Cambio A — Tipo del reconocido**

Buscar la interfaz (o tipo inline) que define los items de `reconocidos`. Agregar el campo `referencia`:

```typescript
interface ReconocidoParseo {
  codigo: string
  valor: number
  /** Rango de referencia declarado en el informe. null si no se menciona. */
  referencia: { minimo: number | null; maximo: number | null } | null
}
```

Actualizar el tipo de retorno de `ResultadoParseo.reconocidos` a `ReconocidoParseo[]`.

**Cambio B — Prompt de sistema (instrucciones y formato JSON)**

Dentro del string del prompt de sistema:

1. En las instrucciones, agregar después de la instrucción de identificar analitos:
```
3. Para cada analito reconocido, extrae también el rango de referencia que aparezca en el informe (columna "Rango", "Valores de referencia", "Referencia normal" o similar). Si el rango tiene forma "70.0 - 100.0", extrae minimo=70.0 y maximo=100.0. Si solo tiene límite inferior (">40") extrae minimo=40.0 y maximo=null. Si solo tiene límite superior ("<200") extrae minimo=null y maximo=200.0. Si no hay referencia visible para ese analito, deja referencia en null.
```
   (Renumerar las instrucciones siguientes si hace falta.)

2. Actualizar el formato de respuesta JSON:
```
{
  "reconocidos": [{ "codigo": "GLU", "valor": 95.0, "referencia": { "minimo": 70.0, "maximo": 100.0 } }],
  "no_reconocidos": [{ "etiqueta": "Ferritina", "valor": "45.2" }]
}
```
   Agregar una nota: `referencia puede ser null si el informe no muestra rango para ese analito.`

**Cambio C — Parseo de la respuesta**

En la función que parsea el JSON devuelto por la IA, extender la lectura de cada `reconocido` para incluir `referencia`. Lógica:
- Si el item tiene `referencia` con al menos una propiedad numérica, mapearla a `{ minimo: number|null, maximo: number|null }`.
- Si falta o no es objeto, asignar `null`.
- Los valores de minimo/maximo deben parsearse con `Number()` y validarse con `Number.isFinite()`; si no son finitos, asignar `null`.

---

## Bloque 3 — Repositorio

### Archivo: `apps/api/src/laboratorios/repositorio.ts`

Leer el archivo completo.

**Cambio A — DatosEstudio**

En la interfaz `DatosEstudio`, cambiar `resultados`:

```typescript
resultados: { codigo: string; valor: number; refMinimo?: number | null; refMaximo?: number | null }[]
```

**Cambio B — crearEstudio: INSERT de resultados**

Localizar el bloque que inserta en `lab_resultado`. Cambiar para incluir las referencias:

```typescript
if (datos.resultados.length > 0) {
  await cliente.query(
    `insert into lab_resultado
       (clinica_id, estudio_id, biomarcador_codigo, valor, ref_minimo, ref_maximo)
     select $2, $1, c, v, rmin, rmax
     from unnest($3::text[], $4::numeric[], $5::numeric[], $6::numeric[]) as t(c, v, rmin, rmax)`,
    [
      id,
      tenantId,
      datos.resultados.map((r) => r.codigo),
      datos.resultados.map((r) => r.valor),
      datos.resultados.map((r) => r.refMinimo ?? null),
      datos.resultados.map((r) => r.refMaximo ?? null),
    ],
  )
}
```

**Cambio C — listarEstudios: CTE con_delta**

En el CTE `valores`, agregar `r.ref_minimo, r.ref_maximo`:

```sql
with valores as (
  select e.id as estudio_id, e.fecha, e.created_at,
         r.biomarcador_codigo as codigo, r.valor,
         r.ref_minimo, r.ref_maximo
  from lab_estudio e
  join lab_resultado r on r.estudio_id = e.id
  where e.paciente_id = $1 and e.clinica_id = $2 and e.estado = 'vigente'
),
con_delta as (
  select *,
         lag(valor) over (partition by codigo order by fecha asc, created_at asc) as anterior
  from valores
)
```

**Cambio D — listarEstudios: SELECT principal con prioridad de referencias**

Reemplazar la parte del SELECT que trae `minimo`, `maximo` y `origen_rango` usando lógica que da prioridad a las referencias del resultado sobre el catálogo:

```sql
select cd.estudio_id, cd.codigo, b.nombre, b.unidad, cd.valor, cd.anterior,
       case
         when cd.ref_minimo is not null or cd.ref_maximo is not null
           then cd.ref_minimo
         when r_sexo.id is not null then r_sexo.minimo
         else r_gen.minimo
       end as minimo,
       case
         when cd.ref_minimo is not null or cd.ref_maximo is not null
           then cd.ref_maximo
         when r_sexo.id is not null then r_sexo.maximo
         else r_gen.maximo
       end as maximo,
       case
         when cd.ref_minimo is not null or cd.ref_maximo is not null
           then 'por_resultado'
         when r_sexo.id is not null then 'por_sexo'
         when r_gen.id  is not null then 'general'
         else 'ninguno'
       end as origen_rango
from con_delta cd
join biomarcador b on b.codigo = cd.codigo
[JOIN_RANGOS igual que antes]
order by b.orden asc
```

Después de este cambio el tipo `FilaResultado` tiene `origen_rango` que puede valer `'por_resultado'`. Verificar que la lógica de `estadoDe` y la comparación `hayRango = r.origen_rango !== 'ninguno'` siga siendo correcta (sí lo es, no hay cambio adicional necesario).

---

## Bloque 4 — Ruta de laboratorios

### Archivo: `apps/api/src/routes/laboratorios.ts`

En el handler `POST /api/pacientes/:id/laboratorios`, dentro del bucle que parsea `crudos`:

Después de validar `codigo` y `valor`, agregar lectura de `refMinimo` y `refMaximo`:

```typescript
const refMinimo =
  typeof fila['refMinimo'] === 'number' && Number.isFinite(fila['refMinimo'])
    ? (fila['refMinimo'] as number)
    : null
const refMaximo =
  typeof fila['refMaximo'] === 'number' && Number.isFinite(fila['refMaximo'])
    ? (fila['refMaximo'] as number)
    : null

vistos.add(codigo)
resultados.push({ codigo, valor, refMinimo, refMaximo })
```

Actualizar el tipo local de `resultados` para incluir `refMinimo` y `refMaximo`:

```typescript
const resultados: { codigo: string; valor: number; refMinimo: number | null; refMaximo: number | null }[] = []
```

---

## Bloque 5 — Frontend: tipos

### Archivo: `apps/web-professional/src/api/tipos.ts`

**Cambio A — PrevisualizacionCsv**

Extender `reconocidos`:

```typescript
export interface PrevisualizacionCsv {
  reconocidos: {
    codigo: string
    nombre: string
    unidad: string
    valor: number
    /** Solo presente en la previsualización de PDF. */
    referencia?: { minimo: number | null; maximo: number | null } | null
  }[]
  noReconocidos: { etiqueta: string; valor: string }[]
  avisos: string[]
}
```

**Cambio B — DatosEstudioEnvio**

Extender `resultados`:

```typescript
export interface DatosEstudioEnvio {
  fecha: string
  laboratorio: string | null
  notas: string | null
  archivoId: string | null
  snapshotId: string | null
  resultados: {
    codigo: string
    valor: number
    /** Rango de referencia declarado por el laboratorio (del PDF). */
    refMinimo?: number | null
    refMaximo?: number | null
  }[]
}
```

---

## Bloque 6 — Frontend: LaboratorioModal

### Archivo: `apps/web-professional/src/components/LaboratorioModal.tsx`

Leer el archivo completo.

**Cambio A — Estado de referencias**

Agregar estado junto a `valores`:

```typescript
const [referencias, setReferencias] = useState<Record<string, { minimo: number | null; maximo: number | null }>>({})
```

**Cambio B — Rama PDF en procesarArchivo**

En el bloque `else if (subido.mime === 'application/pdf')`, después de poblar `iniciales`:

```typescript
const refInicial: Record<string, { minimo: number | null; maximo: number | null }> = {}
for (const r of prev.reconocidos) {
  if (r.referencia) refInicial[r.codigo] = r.referencia
}
setReferencias(refInicial)
```

Agregar también un reset de referencias en la rama CSV y en la rama de imagen/otro:
```typescript
setReferencias({})
```

**Cambio C — Envío al guardar**

Localizar donde se construye el array de `resultados` para llamar a `crearEstudio`. Para cada resultado, incluir las referencias si existen:

```typescript
resultados: Object.entries(valores)
  .filter(([, v]) => v.trim() !== '')
  .map(([codigo, v]) => ({
    codigo,
    valor: parseFloat(v.replace(',', '.')),
    refMinimo: referencias[codigo]?.minimo ?? null,
    refMaximo: referencias[codigo]?.maximo ?? null,
  }))
  .filter((r) => Number.isFinite(r.valor))
```

(Adaptar al patrón exacto que ya usa el modal para construir los resultados.)

---

## Commit final

```
git add apps/api/src/db/migrations/NNN_lab_resultado_referencias.sql \
        apps/api/src/laboratorios/pdf.ts \
        apps/api/src/laboratorios/repositorio.ts \
        apps/api/src/routes/laboratorios.ts \
        apps/web-professional/src/api/tipos.ts \
        apps/web-professional/src/components/LaboratorioModal.tsx

git commit -m "feat(r44): referencias de laboratorio por resultado desde PDF

- Migración: ref_minimo, ref_maximo en lab_resultado
- PDF parser extrae rango de referencia por analito (IA)
- crearEstudio guarda referencias por resultado
- listarEstudios prioriza ref por resultado sobre catálogo global
- LaboratorioModal pasa referencias al guardar

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ES8ko4NzY3HXWX6HJ2zwy6"

git push origin r44-fix-referencias-lab
```
