# NutriSmart · Rebanada 29 — Tendencia de la clínica y exportación

**Objetivo:** que el administrador vea cómo evoluciona la clínica y pueda sacar los datos. Materializa **GAM-03**.

**Sin migraciones.** Todo sale de tablas que ya existen.

---

## Una pantalla, no dos dashboards

Ya había un dashboard administrativo desde la Rebanada 8: KPIs del periodo, agenda del día y actividad por profesional. El encargo pedía un `DashboardAdminPage` nuevo con su propia entrada de menú.

Serían dos entradas llamadas «Dashboard» que responden preguntas distintas y se solapan en la mitad de los números. Lo de la R8 contesta **«qué pasa hoy»**; esto contesta **«cómo va la clínica»**: doce meses de citas y altas, uso de la aplicación, y la exportación.

Van en la misma pantalla, una debajo de la otra.

---

## Las dos cosas que el encargo medía mal

### La adherencia dividía entre quien no puede apuntar

El encargo calculaba el porcentaje sobre **todos** los pacientes activos. Pero un paciente sin cuenta activada no puede apuntar nada: contarlo como incumplidor hunde el número por un motivo que no tiene que ver con la adherencia.

Se calcula sobre los que tienen la aplicación, y la pantalla dice el denominador: «1 de 7 días posibles, sobre 1 paciente con la aplicación activada. Los otros 2 no la tienen todavía y no cuentan: no pueden apuntar nada».

Y si nadie la tiene, se devuelve `null` en vez de `0`: un 0 % diría que nadie apunta, y lo que pasa es que nadie puede.

### El CSV ejecutaba fórmulas

El `toCSV` del encargo escapaba comillas y saltos de línea, pero no las fórmulas. Excel y LibreOffice **ejecutan** lo que empieza por `=`, `+`, `-` o `@`, y aquí se exportan nombres de pacientes y motivos de cita que escribe una persona.

Un motivo de cita que diga `=HYPERLINK("http://…","Ver informe")` se convierte en un enlace ejecutable en el ordenador de quien abra el archivo. Se antepone un apóstrofo, que las hojas de cálculo entienden como «esto es texto» y no se ve al abrirlo.

Comprobado con ese mismo valor: sale como `"'=HYPERLINK(""http://malo.example"",""Ver informe"")"`.

---

## Otras decisiones

### El rastro de la exportación tenía que subir de nivel

Sacar de una vez los datos personales de toda la clínica deja rastro. No hay tabla de auditoría todavía —merece su propia rebanada— así que va al registro del servidor.

Escrito como `info` no habría servido: en producción el logger está en `warn`, así que el rastro solo existiría en desarrollo, que es justo donde no hace falta. Va como `warn`, con quién exportó, de qué clínica y cuántas filas.

### El peso exportado es el de consulta

El encargo sacaba el primero y el último de `registro_metrica`, que es la báscula de casa. En el expediente el peso que cuenta es el que midió el profesional (`medicion_antropometrica`), que es la línea que la Rebanada 22 trazó y que la 23 usó para calcular el progreso. Un informe administrativo que mezcle las dos series no es comparable con nada.

### Los meses vacíos salen como cero

`generate_series` a la izquierda. Sin él, un mes sin citas no sale como cero: sale como que no existe, y la gráfica junta noviembre con enero como si fueran consecutivos.

### Las completadas van dentro de la barra, no al lado

Son un subconjunto de las citas del mes. Ponerlas en paralelo haría creer que se suman.

### Un porcentaje sobre cero citas no se pinta

Un profesional sin citas en los últimos 90 días no aparece con «0 % de cumplimiento» —que leería como que no completó ninguna— sino sin porcentaje.

### Las fechas de la exportación se validan antes de la consulta

El encargo las pasaba tal cual. Un `?desde=ayer` habría dado un rango imposible en vez de un error, y `desde > hasta` habría devuelto un archivo vacío sin explicar por qué.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| `paciente.activo` | `estado` |
| `paciente.sexo` con valores `'M'`/`'F'` | `sexo_biologico`: `masculino`, `femenino`, `intersexual` |
| `cita.fecha`, `cita.hora_inicio`, `cita.duracion_min` | `inicio` (timestamptz), `duracion_minutos` |
| `requireAdmin` como middleware | `comoAdmin(request, reply)`, el de la R28 |
| Página y entrada de menú nuevas | Sección dentro del dashboard existente |

---

## Contrato de API

| Método | Ruta |
|---|---|
| `GET` | `/api/admin/estadisticas` |
| `GET` | `/api/admin/exportar/pacientes` |
| `GET` | `/api/admin/exportar/citas?desde=&hasta=` |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 29.
