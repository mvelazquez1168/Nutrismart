# Rebanada 7 — CLI-07: Sociodemografía en el Expediente

## Alcance

Capturar y mostrar el contexto socioeconómico y de estilo de vida del paciente
como bloque opcional dentro del expediente clínico. Los datos alimentan la
interpretación nutricional (sedentarismo, horas de sueño, consumo de alcohol)
y el análisis de adherencia al plan.

**Fuera de alcance en esta rebanada:**
- Motor de recomendaciones basado en sociodemografía
- Análisis cruzado entre campos socioeconómicos y marcadores clínicos
- Exportación / reporte de sociodemografía (se integra en el PDF de CLI-05 en rebanada posterior)
- Campos de salud mental o historial clínico (pertenecen a otra épica)

---

## Decisión de diseño: tabla separada

Los datos socioeconómicos van en una tabla `paciente_sociodemografico` (1-a-1 con `paciente`),
no como columnas en `paciente`. Razones:

1. **Privacidad / minimización**: se puede leer el expediente sin exponer estos datos
   a usuarios que no los necesitan.
2. **Consentimiento explícito**: el registro de que el paciente autorizó la recolección
   vive junto a los datos, no disperso.
3. **Nulabilidad limpia**: ausencia de fila = no se ha recolectado, semánticamente
   diferente a "recolectado y vacío".
4. **Migraciones futuras**: agregar o renombrar campos no toca la tabla `paciente`.

---

## Set de campos (v1)

### Actividad y hábitos

| Campo | Tipo DB | Valores | Notas |
|---|---|---|---|
| `nivel_actividad` | ENUM | sedentario · leve · moderada · intensa | MET aproximado |
| `horas_sueno` | SMALLINT | 1–24 | Promedio declarado por noche |
| `tabaco` | BOOLEAN | true/false | Fumador activo al momento del registro |
| `alcohol` | ENUM | nunca · ocasional · frecuente | Ocasional = ≤ 2 veces/semana |

### Contexto social

| Campo | Tipo DB | Valores | Notas |
|---|---|---|---|
| `ocupacion` | TEXT (80) | libre | No enum; demasiada variedad en CR |
| `escolaridad` | ENUM | ninguna · primaria · secundaria · tecnica · universitaria · posgrado | |
| `personas_en_hogar` | SMALLINT | 1–20 | Cuántas personas viven con el paciente |
| `tipo_hogar` | ENUM | solo · pareja · familia_nuclear · familia_extendida · compañeros | |

### Consentimiento

| Campo | Tipo DB | Notas |
|---|---|---|
| `consentimiento_otorgado` | BOOLEAN NOT NULL | false hasta que el paciente autorice explícitamente |
| `consentimiento_fecha` | TIMESTAMPTZ | NULL si no otorgado; se registra al marcar true |
| `consentimiento_profesional_id` | UUID → profesional | Quién registró el consentimiento |

Todos los campos de contenido son NULLABLE excepto el bloque de consentimiento.
Si `consentimiento_otorgado = false`, la API devuelve el bloque con `datos: null`.

---

## Modelo de datos

### ENUMs

```sql
CREATE TYPE nivel_actividad_fisica AS ENUM
  ('sedentario', 'leve', 'moderada', 'intensa');

CREATE TYPE frecuencia_alcohol AS ENUM
  ('nunca', 'ocasional', 'frecuente');

CREATE TYPE nivel_escolaridad AS ENUM
  ('ninguna', 'primaria', 'secundaria', 'tecnica', 'universitaria', 'posgrado');

CREATE TYPE tipo_hogar AS ENUM
  ('solo', 'pareja', 'familia_nuclear', 'familia_extendida', 'compañeros');
```

### Tabla `paciente_sociodemografico`

```sql
CREATE TABLE paciente_sociodemografico (
  paciente_id                  UUID PRIMARY KEY REFERENCES paciente(id),
  -- Actividad y hábitos
  nivel_actividad              nivel_actividad_fisica,
  horas_sueno                  SMALLINT CHECK (horas_sueno BETWEEN 1 AND 24),
  tabaco                       BOOLEAN,
  alcohol                      frecuencia_alcohol,
  -- Contexto social
  ocupacion                    TEXT CHECK (char_length(ocupacion) <= 80),
  escolaridad                  nivel_escolaridad,
  personas_en_hogar            SMALLINT CHECK (personas_en_hogar BETWEEN 1 AND 20),
  tipo_hogar                   tipo_hogar,
  -- Consentimiento
  consentimiento_otorgado      BOOLEAN NOT NULL DEFAULT false,
  consentimiento_fecha         TIMESTAMPTZ,
  consentimiento_profesional_id UUID REFERENCES profesional(id),
  -- Auditoría
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_paciente_sociodemografico_updated_at
  BEFORE UPDATE ON paciente_sociodemografico
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### Invariante de consentimiento (trigger)

```sql
-- Al poner consentimiento_otorgado = true, registrar fecha y profesional automáticamente.
-- Al revocar (false), limpiar fecha y profesional.
CREATE OR REPLACE FUNCTION fn_socio_consentimiento()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.consentimiento_otorgado = true AND OLD.consentimiento_otorgado = false THEN
    NEW.consentimiento_fecha              := now();
    -- consentimiento_profesional_id debe venir en el UPDATE; no se toca aquí
  ELSIF NEW.consentimiento_otorgado = false THEN
    NEW.consentimiento_fecha              := NULL;
    NEW.consentimiento_profesional_id     := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_socio_consentimiento
  BEFORE UPDATE ON paciente_sociodemografico
  FOR EACH ROW EXECUTE FUNCTION fn_socio_consentimiento();
```

---

## Migración

Archivo: `apps/api/migrations/009_paciente_sociodemografico.sql`

Contiene en orden: ENUMs → tabla → trigger updated_at → trigger consentimiento.
Todo en una sola transacción BEGIN/COMMIT.

---

## Endpoints

Todos requieren JWT. `paciente_id` en URL; visibilidad por `resolverAlcance` (igual que snapshots).

### `GET /api/pacientes/:pacienteId/sociodemografico`

Devuelve el bloque completo. Si no existe fila → 200 con `datos: null, consentimiento_otorgado: false`.
Si existe y `consentimiento_otorgado = false` → devuelve el bloque de consentimiento pero `datos: null`.
Si `consentimiento_otorgado = true` → devuelve todo.

**Respuesta con consentimiento y datos:**
```json
{
  "consentimiento_otorgado": true,
  "consentimiento_fecha": "2026-08-13T14:00:00Z",
  "datos": {
    "nivel_actividad":   "moderada",
    "horas_sueno":       7,
    "tabaco":            false,
    "alcohol":           "ocasional",
    "ocupacion":         "Docente de primaria",
    "escolaridad":       "universitaria",
    "personas_en_hogar": 4,
    "tipo_hogar":        "familia_nuclear"
  }
}
```

---

### `PUT /api/pacientes/:pacienteId/sociodemografico`

Upsert de todos los campos. Si `consentimiento_otorgado` pasa de false → true,
el API registra `consentimiento_profesional_id = req.auth.sub` antes del UPDATE.

**Body:**
```json
{
  "consentimiento_otorgado": true,
  "nivel_actividad":   "moderada",
  "horas_sueno":       7,
  "tabaco":            false,
  "alcohol":           "ocasional",
  "ocupacion":         "Docente de primaria",
  "escolaridad":       "universitaria",
  "personas_en_hogar": 4,
  "tipo_hogar":        "familia_nuclear"
}
```

Validaciones:
- `horas_sueno`: entero 1–24
- `personas_en_hogar`: entero 1–20
- `ocupacion`: máx 80 chars
- ENUMs: validados contra los valores permitidos (400 si no coincide)
- Si `consentimiento_otorgado` pasa a false: los datos de contenido se aceptan
  pero no se mostrarán hasta que el consentimiento vuelva a ser true

---

## Seed

Sin datos de sociodemografía en seed de desarrollo — facilita probar el flujo
completo desde cero (sin fila → otorgar consentimiento → llenar datos).

---

## Frontend

### Ubicación en la UI

Nuevo bloque colapsable **"Contexto social"** en `PacienteFicha.tsx`,
debajo del bloque de alergias, antes del timeline de snapshots.

### Estados del bloque

**Sin fila / sin consentimiento:**
```
┌─ Contexto social ──────────────────────────────────┐
│  ⚠ No se ha registrado el consentimiento del       │
│    paciente para recopilar estos datos.             │
│                                                     │
│  [Registrar consentimiento y completar datos]       │
└─────────────────────────────────────────────────────┘
```

**Con consentimiento, datos incompletos:**
Muestra el formulario vacío (campos en blanco) listo para llenar.

**Con consentimiento y datos:**
Muestra los datos como lista de solo lectura con botón "Editar".
Al editar, abre el formulario in situ (no modal, no página nueva).

### Componente `SociodemografiaBloque.tsx`

Props: `pacienteId: string`

Internamente:
1. Fetch a `GET /api/pacientes/:id/sociodemografico` al montar
2. Si `consentimiento_otorgado = false` → muestra aviso + botón
3. Si true → muestra datos o formulario según modo (`lectura` / `edicion`)

El formulario usa los mismos patrones de validación que el alta de paciente.

### Campos del formulario

```
Nivel de actividad física   [Select: Sedentario / Leve / Moderada / Intensa]
Horas de sueño por noche    [Number input: 1-24]
Fuma actualmente            [Toggle: Sí / No]
Consumo de alcohol          [Select: Nunca / Ocasional / Frecuente]

Ocupación                   [Text: máx 80 chars]
Escolaridad                 [Select: Ninguna / Primaria / Secundaria / Técnica / Universitaria / Posgrado]
Personas en el hogar        [Number input: 1-20]
Tipo de hogar               [Select: Solo / En pareja / Familia nuclear / Familia extendida / Compañeros]
```

El checkbox / toggle de consentimiento es el primero del formulario, con texto:
> "El paciente ha autorizado verbalmente la recopilación de esta información
>  con fines de análisis nutricional."

No se puede guardar sin marcar consentimiento.

---

## Criterios de aceptación

### CA-07-01 — Sin fila: aviso de consentimiento
Dado que el paciente no tiene fila en `paciente_sociodemografico`,
cuando el profesional abre la ficha del paciente,
entonces el bloque "Contexto social" muestra el aviso de consentimiento pendiente.

### CA-07-02 — Sin consentimiento no se ven datos
Dado que existe una fila con `consentimiento_otorgado = false`,
cuando el API responde a GET /sociodemografico,
entonces `datos` es null aunque los campos tengan valor en DB.

### CA-07-03 — Guardar con consentimiento
Dado que el profesional marca consentimiento y llena los campos,
cuando hace clic en Guardar,
entonces la fila se crea con `consentimiento_otorgado = true` y los datos visibles en la ficha.

### CA-07-04 — Aislamiento de tenant
Dado que Clínica B tiene un paciente con sociodemografía completa,
cuando el profesional de Clínica A consulta su propio paciente homónimo,
entonces no ve los datos de Clínica B.

### CA-07-05 — Validaciones de rango
- `horas_sueno = 0` → 400
- `horas_sueno = 25` → 400
- `personas_en_hogar = 0` → 400
- `ocupacion` con 81 chars → 400
- `nivel_actividad = "muy_intensa"` (valor inválido) → 400

### CA-07-06 — Revocación de consentimiento
Dado que el profesional desmarca el consentimiento y guarda,
cuando el API procesa el PUT,
entonces `consentimiento_fecha` y `consentimiento_profesional_id` quedan NULL en DB,
y un GET posterior devuelve `datos: null`.

### CA-07-07 — Campos opcionales
Dado que el profesional guarda con consentimiento pero deja `ocupacion` en blanco,
entonces el registro se crea sin error (campo nullable).

### CA-07-08 — Solo nutricionista propio o admin_clinica puede editar
Dado que el profesional A intenta hacer PUT sobre el paciente del profesional B,
entonces la API responde 403.

---

## Orden de implementación

1. `009_paciente_sociodemografico.sql` — migración (ENUMs + tabla + triggers)
2. `apps/api/src/routes/sociodemografico.ts` — GET y PUT
3. `apps/api/src/server.ts` — registrar ruta
4. `SociodemografiaBloque.tsx` — componente con tres estados
5. `PacienteFicha.tsx` — integrar bloque
6. `docs/PRUEBAS.md` — sección Rebanada 7
7. Commit
