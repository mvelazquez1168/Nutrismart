# NutriSmart · Rebanada 27 — Alertas de seguimiento

**Objetivo:** que el profesional fije umbrales por paciente y el sistema le avise cuando se cruzan. Materializa **RPM-03**.

**Migraciones 031 y 032.**

---

## Lo que decide si esta función sirve o estorba

Un sistema de alertas es fácil de construir y muy fácil de construir mal. Si genera ruido, el profesional deja de mirarlo, y entonces también se pierden las que importaban. Tres decisiones del encargo llevaban justo ahí.

### 1. La alerta que no se cierra nunca

El encargo creaba alertas y no las cerraba jamás. Una glucosa que subió el martes y bajó el miércoles dejaba una alerta viva para siempre. A las tres semanas el panel es una lista de cosas ya resueltas.

Ahora cada pasada del motor **cierra primero** lo que ya no se cumple y **abre después** lo que sí. Se distingue `resuelta_auto`: una alerta que se arregló sola y una que alguien atendió no dicen lo mismo.

### 2. La alerta diaria sobre un dato de hace seis meses

Una regla «peso > 90» miraba la última lectura existente, tuviera la edad que tuviera. Un paciente que dejó de pesarse hace medio año con 91 kg generaría una alerta nueva **todos los días, para siempre**, sobre una medición de hace seis meses.

Se añade `ventana_dias` (14 por defecto): si la última lectura es más vieja, la regla no se evalúa. El problema entonces no es el peso, es que no hay datos — y para eso están las métricas `dias_sin_*`.

Comprobado: con una lectura de hace 60 días, ventana 14 → `omitidasPorAntiguedad: 1`; ventana 90 → la alerta se abre.

### 3. Una alerta por día contra una alerta por problema

El encargo ponía la clave única en `(paciente, métrica, día)`. Dos consecuencias:

- Mientras el problema durase, **una fila nueva cada día**.
- Un paciente con dos reglas sobre la misma métrica —peso alto y peso bajo, que es el par natural— solo podía generar una: la segunda la descartaba el `ON CONFLICT DO NOTHING` en silencio.

Aquí la unidad es el **problema**, no el día: un índice único parcial sobre `config_id where estado <> 'resuelta'`. Una alerta viva por regla; cuando se resuelve y el problema reaparece, se abre otra. Verificado: las dos reglas de peso conviven, cada una con su cuenta.

---

## Otras decisiones

### El paciente que nunca empezó

`max(fecha)` de ninguna fila es `null`, así que las métricas de silencio se saltaban justo al caso que más interesa: el que recibió la invitación, entró una vez y no volvió. Se cuenta desde `invitacion_paciente.usado_en` cuando no hay ningún registro.

Quien no ha activado cuenta sigue fuera, y es correcto: no puede apuntar nada, y avisar al profesional todos los días de eso es ruido.

### «Vista» y «atendida» son distintas

- **Vista** (`reconocida`): la he leído. La alerta sigue abierta y **no se duplica**.
- **Atendida** (`resuelta`): está resuelta. Si al día siguiente el problema persiste, **vuelve a abrirse** — el profesional dijo que estaba atendida y no lo estaba.

Ambas comprobadas.

### El correo va al profesional, no al paciente

Decirle a alguien por correo «tu glucosa está alta» sin nadie que lo interprete es alarmar sin ayudar. Es la regla del proyecto: la máquina asiste, el profesional decide.

Se marca `email_enviado` **antes** de enviar, con un `UPDATE … RETURNING` sobre las filas que consiguió marcar. Si el envío falla se pierde ese aviso; la alternativa —marcar después— reenvía el mismo correo en cada ciclo cuando algo falla entre medias. Mismo criterio que la R21.

### Se evalúa al guardar la regla, no solo por la mañana

Si no, el profesional pone un umbral y no pasa nada hasta el día siguiente: parece que no funciona.

### Retirar una regla cierra sus alertas

Mantener viva una alerta de una regla que ya nadie vigila es pedir atención sobre algo que no se está mirando. Va en la misma transacción.

### Una consulta de conjunto, no un bucle

El encargo recorría las configuraciones y hacía una consulta dentro del bucle. Con quinientos pacientes y tres reglas cada uno son mil quinientas idas y vueltas a la base cada mañana. Ahora es un `LEFT JOIN LATERAL` por origen y un `CASE` que elige el que toca.

### La columna de alertas no pinta ceros

Una columna llena de ceros esconde los pocos que no lo son. Sin alertas se pinta un guión.

---

## Dos fallos heredados de la R26 que reaparecían

`registro_metrica.fecha` **no existe** — es `medido_en`. Estaba en el motor otra vez.

Y los días de silencio se contaban con `extract(day from interval)`, que devuelve **solo el componente «días»** del intervalo: para un mes y tres días da 3, no 33. Justo en la métrica que existe para detectar abandonos largos. Se cuenta restando fechas (`date - date` da un entero de días).

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| `apps/api/src/db/migrations/` | `apps/api/migrations/` |
| `schema_migrations.migration_name` | `version` |
| `app.authenticate`, `pool` por parámetro | `requireAuth`, `pool` importado |
| `/api/profesional/alertas/…` | `/api/alertas` y `/api/pacientes/:id/alertas/config` |
| `config.resend.remitente` | `config.resend.from` |
| Sin control de alcance | `resolverAlcance` en las cuatro rutas (CLI-02) |
| Cron a las 8:00 «hora local» | `0 13 * * *` — el contenedor corre en UTC y Costa Rica es UTC−6 |

---

## Contrato de API

| Método | Ruta |
|---|---|
| `GET` `PUT` | `/api/pacientes/:id/alertas/config` |
| `DELETE` | `/api/pacientes/:id/alertas/config/:configId` |
| `GET` | `/api/alertas?estado=&pacienteId=` |
| `PATCH` | `/api/alertas/:id` — `reconocida` \| `resuelta` |

`GET /api/rpm/pacientes` pasa a incluir `alertasAbiertas`, que la R26 dejó deliberadamente fuera.

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 27.
