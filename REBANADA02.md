# NutriSmart · Rebanada 2 — Alta, edición y ficha del paciente

**Objetivo:** completar el ciclo de vida del paciente (crear, editar, ver, dar de baja) sobre los cimientos de la Rebanada 1. Materializa **CLI-02** (gestión de pacientes) y arranca **CLI-01** (expediente, pestaña Resumen).

**Depende de:** Rebanada 1 (auth, tenancy, lista de pacientes).

---

## Alcance

**Incluye:**
- Migración `002`: extiende `paciente` (`motivo_consulta`) y agrega `paciente_diagnostico` y `paciente_alergia`.
- API: `POST /api/pacientes`, `GET /api/pacientes/:id`, `PUT /api/pacientes/:id`, `POST /api/pacientes/:id/baja` — todo acotado al tenant.
- Frontend: **modal "Nuevo paciente"** (ligero), **modal "Editar paciente"**, **ficha del paciente** (pestaña Resumen) y **baja lógica** con confirmación.
- Numeración automática de `numero_expediente` por clínica.

**NO incluye (siguientes rebanadas):** timeline/snapshots, métricas vitales longitudinales, labs, agenda, sociodemografía completa. La ficha muestra lo que existe hoy; el resto son placeholders "próximamente".

**Principio clave:** el alta es **ligera** (identidad + motivo + diagnósticos + alergias). El expediente clínico completo (ABCD) se llena después, no en la creación.

---

## Modelo de datos

Ver `apps/api/migrations/002_paciente_detalle.sql`:
- `paciente.motivo_consulta` (texto).
- `paciente_diagnostico` (lista; `descripcion`, `cie10` opcional, `activo`).
- `paciente_alergia` (lista; `descripcion`, permite "Ninguna").
- Todas con `clinica_id` (tenant) e índices.

## Contrato de API

Requieren `Authorization: Bearer <token>`. El middleware acota por `clinica_id` del token. Cualquier `:id` de otra clínica → **404** (no revelar existencia).

### `POST /api/pacientes`
Crea el paciente. `numero_expediente` se asigna como `max(numero_expediente)+1` de la clínica, en transacción.
```json
// body
{
  "nombre": "Laura Méndez",
  "documentoTipo": "cedula",
  "documentoNumero": "4-4444-4444",
  "fechaNacimiento": "1990-05-14",
  "sexoBiologico": "femenino",
  "telefono": "8888-8888",
  "correo": "laura@correo.cr",
  "motivoConsulta": "Bajar de peso",
  "diagnosticos": ["Sobrepeso"],
  "alergias": ["Ninguna"]
}
// respuesta 201
{ "id": "…", "numeroExpediente": 4, "estado": "activo" }
```
Validaciones: `documentoNumero` único por clínica; `correo` válido; `alergias` obligatorio (permitir explícitamente "Ninguna"); `nombre` requerido.

### `GET /api/pacientes/:id`
```json
{
  "id": "…", "numeroExpediente": 2, "nombre": "Juan Ramírez",
  "edad": 58, "sexoBiologico": "masculino",
  "documento": { "tipo": "cedula", "numero": "2-2222-2222" },
  "telefono": "…", "correo": "…",
  "estado": "activo", "estadoClinico": "alerta",
  "motivoConsulta": "Control de diabetes",
  "diagnosticos": [{ "descripcion": "Diabetes tipo 2" }, { "descripcion": "Hipertensión" }],
  "alergias": [{ "descripcion": "Penicilina" }],
  "nutricionista": "Dra. Ana Rodríguez"
}
```

### `PUT /api/pacientes/:id`
Mismo cuerpo que POST; actualiza datos, diagnósticos y alergias (reemplaza las listas). Versionado no aplica aquí (los datos demográficos son mutables; lo clínico versionado llega con los snapshots).

### `POST /api/pacientes/:id/baja`
```json
{ "motivo": "No continúa tratamiento" }   // opcional
```
Efecto: `estado = 'baja'`. **No borra**: el paciente permanece en la base (trazabilidad) y deja de aparecer en la lista.

## Frontend (app profesional)

- **Modal "Nuevo paciente"** (sobre la lista): dos secciones — Identidad (nombre, documento, fecha de nacimiento → edad calculada, sexo biológico, teléfono, correo) y Contexto inicial (motivo, diagnósticos como chips, alergias con "Ninguna"). Botones "Cancelar" y "Crear paciente"; opción "Crear y agendar primera cita" (deshabilitada, próxima rebanada). Validación inline; carga en el botón.
- **Modal "Editar paciente"**: igual, pre-poblado.
- **Ficha del paciente** (`/pacientes/:id`): encabezado (avatar, nombre, edad, badge de estado clínico) con acciones "Editar" y "Dar de baja"; pestañas (Resumen activa; Citas/Historial/Sociodemografía como placeholders). Resumen: card de datos demográficos, card de diagnósticos (chips), card de alergias (destacada), motivo de consulta. Cards de métricas vitales / timeline como placeholder "Aún sin registros — se llenan en la primera valoración".
- **Baja lógica**: diálogo de confirmación que deja claro que es reversible/archivado, no borrado.

## Criterios de aceptación

- Crear un paciente válido → aparece en la lista con su `numero_expediente` y estado "Activo".
- Documento duplicado en la misma clínica → error de validación (no se crea).
- `alergias` vacío → error ("indica las alergias o marca Ninguna").
- Editar y guardar → los cambios (incluidos diagnósticos y alergias) persisten.
- Dar de baja → `estado='baja'`, desaparece de la lista, sigue en la base.
- Intentar ver/editar un paciente de OTRA clínica → 404.
- La ficha muestra los diagnósticos y alergias del seed para Juan (Diabetes tipo 2, Hipertensión / Penicilina).

---

## Prompt para Claude Code (pégalo en `c:\nutrismart`)

```
Lee CLAUDE.md, docs/REBANADA-02.md, apps/api/migrations/002_paciente_detalle.sql y el
código ya existente de la Rebanada 1. Implementa la Rebanada 2 en pasos pequeños:

1) Aplica la migración 002 con el runner incremental (no reintentar 001). Actualiza el
   seed de desarrollo (ya incluye motivo, diagnósticos y alergias).
2) API (acotando SIEMPRE por clinica_id del token):
   - POST /api/pacientes (asigna numero_expediente = max+1 de la clínica en transacción;
     valida documento único por clínica, correo, alergias obligatorio).
   - GET /api/pacientes/:id (404 si es de otra clínica).
   - PUT /api/pacientes/:id (reemplaza listas de diagnósticos y alergias).
   - POST /api/pacientes/:id/baja (estado='baja', sin borrado físico).
3) Frontend (app profesional, con el design system):
   - Modal "Nuevo paciente" y "Editar paciente" (ligeros, según docs/REBANADA-02.md).
   - Ficha del paciente /pacientes/:id (pestaña Resumen + placeholders).
   - Baja con diálogo de confirmación (archivar, no borrar).
4) Verifica los criterios de aceptación de docs/REBANADA-02.md.

Trabaja en pasos verificables. No dependas del código de Vetline; adáptalo solo como referencia.
```
