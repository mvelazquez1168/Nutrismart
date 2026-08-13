# NutriSmart · Rebanada 8 — Dashboard administrativo

**Objetivo:** dar al administrador de la clínica una vista de la actividad — citas, pacientes, controles y laboratorios — con la agenda del día y el reparto por profesional. Materializa **CLI-08**.

**Depende de:** Rebanada 1 (auth, tenancy), 2 (pacientes), 3 (controles), 4 (agenda), 5 (laboratorios) y 6 (la puerta por rol `admin_clinica` en la interfaz).

---

## Alcance

**Incluye:**
- Migración `010`: índices compuestos `(clinica_id, fecha)` en `cita`, `clinical_snapshot` y `lab_estudio`.
- `GET /api/admin/dashboard?periodo=hoy|semana|mes`, solo para `admin_clinica`.
- Ocho KPIs, agenda del día y actividad por profesional.
- `KpiTile`, `AgendaHoy` y `TablaProfesionales` como componentes reutilizables.
- Ruta `/admin/dashboard` y activación del enlace **Dashboard** del menú lateral.

**NO incluye:** gráficas de evolución, comparativa contra el período anterior, exportación, rangos de fecha a medida y métricas clínicas agregadas (peso medio, adherencia). Todo eso pide una conversación sobre qué decisiones toma el administrador con cada número, que aún no se ha tenido.

---

## Decisiones tomadas

1. **El período llega hasta su final, no hasta `now()`.** Es el cambio de fondo respecto a la especificación de partida. Cortar la ventana en el instante actual deja fuera las citas ya agendadas para más tarde, y entonces el KPI **Pendientes** no puede contar nada: una cita pendiente está, por definición, en el futuro. Con el corte en `now()`, un administrador que mira "Este mes" el día 13, con cinco citas en la agenda, ve un cero.

2. **La ventana la calcula Postgres, no Node.** "Hoy" y "este mes" dependen del huso de la clínica, no del reloj del servidor. Con el proceso en UTC, truncar `new Date()` a medianoche empieza el día a las 18:00 del día anterior en Costa Rica. Es el mismo error que ya documentó la agenda en la Rebanada 4, y la única defensa es no calcular fechas locales fuera de la base.

3. **El huso viaja como parámetro, no incrustado en el SQL.** Hoy es una constante —todas las clínicas están en Costa Rica— pero debería ser una columna de `clinica` en cuanto haya una fuera. Pasarlo como parámetro deja el cambio en un solo sitio.

4. **La agenda es siempre la de hoy**, ignorando el selector de período. Responde a "¿qué toca ahora?", que no es una estadística del rango: mostrar la agenda de todo un mes en el dashboard sería una segunda pantalla de Agenda, peor que la que ya existe.

5. **Un profesional sin citas aparece con ceros.** El `LEFT JOIN` lleva las condiciones de período **dentro del `ON`**; moverlas al `WHERE` lo convertiría en un `INNER JOIN` silencioso y esas filas desaparecerían — justo las que el administrador busca.

6. **`0/0` se muestra como `—`, no como `0.0 %`.** Un cero por ciento lee como "no completó ninguna de las que tenía", que es un juicio distinto de "no tenía ninguna".

7. **Las citas canceladas cuentan.** No se filtran: se cuentan aparte. Un mes con muchas cancelaciones es información, y esconderlas dejaría el total sin cuadrar con la agenda.

8. **Los laboratorios anulados no cuentan.** Un estudio cargado por error y anulado no es trabajo hecho; incluirlo inflaría la actividad.

9. **Aquí el 403 sí es correcto.** Al revés que en las rutas con `:pacienteId`, donde un 403 confirmaría que cierto paciente existe. El recurso es la propia clínica del solicitante, cuya existencia ya conoce por su token: negarle el rol no filtra nada.

---

## Ajustes contra el esquema real

La especificación de partida asumía un modelo que no es el de este proyecto:

| Asumido | Real |
|---|---|
| `cita.activo = true` | No existe. El ciclo de vida es el enum `estado` |
| tabla `snapshot` | `clinical_snapshot` |
| `snapshot.activo` | `estado`: `borrador` \| `cerrado` \| `corregido` |
| `paciente.activo` | `estado`: `activo` \| `inactivo` \| `baja` |
| `paciente.profesional_id` | `nutricionista_id` |
| `profesional.activo` | `estado <> 'inactivo'` |
| tabla de laboratorio sin nombrar | `lab_estudio` |
| `BEGIN; … COMMIT;` en la migración | El runner ya envuelve cada archivo en su transacción |
| `CREATE INDEX CONCURRENTLY` | Imposible dentro de esa transacción; se usa `if not exists` |

El aviso sobre `CONCURRENTLY` venía en el propio encargo y se comprobó: `src/migrate.ts` abre `begin` por archivo, así que `CONCURRENTLY` habría fallado. No es pérdida — las tablas son pequeñas y el bloqueo dura milisegundos. El día que haya que indexar en caliente sobre millones de filas, se hace fuera del runner.

---

## Contrato de API

### `GET /api/admin/dashboard?periodo=hoy|semana|mes`
`Bearer` obligatorio y rol `admin_clinica`. Un `periodo` desconocido cae en `mes` en vez de dar 400: es un parámetro de presentación, y romper la pantalla entera por una cadena mal escrita en la URL sería desmedido.

```json
{
  "periodo": "mes",
  "desde": "2026-08-01T06:00:00.000Z",
  "hasta": "2026-09-01T06:00:00.000Z",
  "generadoEn": "2026-08-13T18:55:00.000Z",
  "kpis": {
    "citasTotal": 5, "citasCompletadas": 2, "citasCanceladas": 1, "citasPendientes": 2,
    "pacientesActivos": 3, "pacientesNuevos": 3,
    "snapshotsCreados": 10, "examenesSubidos": 3
  },
  "agendaHoy": [
    { "citaId": "…", "inicio": "2026-08-13T21:00:00.000Z", "fin": "2026-08-13T22:00:00.000Z",
      "estado": "programada", "paciente": "María Fernández", "profesional": "Dra. Ana Rodríguez" }
  ],
  "porProfesional": [
    { "profesionalId": "…", "nombre": "Dra. Ana Rodríguez",
      "citasTotal": 3, "citasCompletadas": 2, "pacientesActivos": 1 }
  ]
}
```

Los instantes viajan **en crudo**, sin formatear. El servidor no conoce el huso del navegador; formatear allí es lo que hacía mostrar las 21:00 para una cita de las 15:00.

Siete consultas en paralelo con `Promise.all`: son independientes y encadenarlas multiplicaría la espera por siete antes de poder pintar nada.

---

## Frontend

- **`/admin/dashboard`**, protegida: un nutricionista que teclee la URL vuelve a Pacientes. No es la defensa — la API responde 403 igual.
- **El enlace Dashboard del menú deja de estar apagado**, pero solo para `admin_clinica`. Ya existía como promesa desde la Rebanada 1.
- **Selector de período** como `radiogroup`, no como tres botones sueltos: así el lector de pantalla anuncia cuál está elegido.
- **Esqueletos mientras carga**, no un salto de cero a la cifra real.
- **`ChipEstadoCita`** se extrae de `Agenda.tsx` a un componente compartido. Duplicar los colores de estado es cómo dos pantallas acaban discrepando sobre qué significa "cancelada".
- Los tiles usan tokens (`bg-surface`, `text-ink`, `text-muted`), no la escala gris de Tailwind: un `bg-white` fijo ignora el white-label de la Rebanada 6.

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 8 (CA-08-01 … CA-08-07).

- `admin_clinica` → **200** con la estructura completa.
- `nutricionista` → **403**. Sin token → **401**.
- Los tres períodos devuelven ventanas distintas, todas en huso de Costa Rica.
- Una cita a las 23:30 hora local **aparece** en la agenda de hoy; comparando en UTC se perdería.
- Las citas futuras del mes **cuentan** en el total y en Pendientes.
- Un profesional sin citas aparece con ceros, no desaparece.
- `/admin/dashboard` con `luis@vida.cr` redirige a Pacientes.
