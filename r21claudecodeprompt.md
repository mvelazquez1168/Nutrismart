# R21 — AGE-03 Recordatorios automáticos + AGE-04 Vista mensual y enlace cita → consulta

## Contexto obligatorio — leer antes de tocar cualquier archivo

- Monorepo: `apps/api` (Fastify), `apps/web-professional` (Vite + React, puerto 5173), `apps/web-patient` (Vite + React, puerto 5175)
- Columnas reales: `paciente.correo`, `paciente.nombre_completo`, `paciente.estado`, `paciente.sexo_biologico`, `clinica.nombre_comercial`
- `cita.inicio` y `cita.fin` son TIMESTAMPTZ — un solo campo cada uno, no fecha + hora separados
- `clinica_id` de profesional: `request.auth.tenantId`
- `clinica_id` de paciente: `SELECT clinica_id FROM paciente WHERE keycloak_user_id = request.user.sub`
- Colores siempre vía CSS vars o clases Tailwind derivadas de tokens — nunca hex hardcodeado
- Nunca DELETE físico; soft-delete (`estado = 'cancelada'` en citas)
- Emails vía Resend (`RESEND_API_KEY` en `.env` raíz). Si no está configurada, imprimir enlace/datos en consola y continuar sin lanzar excepción
- La tabla `cita` ya tiene `recordatorio_24h BOOLEAN DEFAULT false` y `recordatorio_1h BOOLEAN DEFAULT false`
- Framework: **Fastify** — nunca Express

---

## Paso 0 — Verificar prerequisito (r20 ejecutado)

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'cita'
  AND column_name IN ('recordatorio_24h', 'recordatorio_1h', 'inicio', 'fin');
```

Si devuelve menos de 4 filas, detener y mostrar: "Ejecuta r20 primero — faltan columnas en la tabla cita."

---

## Paso 1 — Instalar node-cron

```bash
cd apps/api
npm install node-cron
npm install --save-dev @types/node-cron
```

---

## Paso 2 — Email de recordatorio de cita

Crear `apps/api/src/agenda/email-recordatorio.ts`:

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.RESEND_FROM ?? 'NutriSmart <onboarding@resend.dev>';

export async function enviarRecordatorioCita(opts: {
  emailPaciente: string;
  nombrePaciente: string;
  nombreClinica: string;
  fechaHora: Date;
  tipoCita: string;
  horasAntes: 24 | 1;
  appUrl: string;
}): Promise<void> {
  const fechaStr = opts.fechaHora.toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const horaStr = opts.fechaHora.toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit',
  });
  const cuandoLabel = opts.horasAntes === 24 ? 'mañana' : 'en 1 hora';
  const subject = `Recordatorio: tu cita en NutriSmart es ${cuandoLabel}`;

  if (!process.env.RESEND_API_KEY) {
    console.log('──────────────────────────────────────────');
    console.log('[AGE] RESEND_API_KEY no configurada — modo consola');
    console.log(`[AGE] Recordatorio (${opts.horasAntes}h) para: ${opts.emailPaciente}`);
    console.log(`[AGE] Cita: ${fechaStr} a las ${horaStr} — ${opts.tipoCita}`);
    console.log('──────────────────────────────────────────');
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to:   opts.emailPaciente,
    subject,
    text: `Hola ${opts.nombrePaciente},\n\nTe recordamos que tienes una cita de ${opts.tipoCita} en ${opts.nombreClinica} el ${fechaStr} a las ${horaStr}.\n\nRevisa tu cita en: ${opts.appUrl}/citas`,
    html: `
      <p>Hola <strong>${opts.nombrePaciente}</strong>,</p>
      <p>Te recordamos que tienes una cita de <strong>${opts.tipoCita}</strong>
         en <strong>${opts.nombreClinica}</strong>:</p>
      <p style="font-size:20px;font-weight:600;color:#0E7C66;">
        ${fechaStr} &mdash; ${horaStr}
      </p>
      <p>
        <a href="${opts.appUrl}/citas"
           style="background:#0E7C66;color:#fff;padding:12px 24px;border-radius:8px;
                  text-decoration:none;font-weight:600;display:inline-block;margin:16px 0;">
          Ver mi cita
        </a>
      </p>
      <p style="color:#6B7280;font-size:14px;">
        Si no puedes asistir, contacta a tu nutricionista con anticipación.
      </p>
    `,
  });

  if (error) {
    // No lanzar — el fallo de email no debe detener el proceso de la app
    console.error('[AGE] Error Resend recordatorio:', error);
  }
}
```

---

## Paso 3 — Módulo de recordatorios

Crear `apps/api/src/agenda/recordatorios.ts`:

```typescript
import { Pool } from 'pg';
import { enviarRecordatorioCita } from './email-recordatorio';

interface FilaCita {
  id: string;
  inicio: Date;
  tipo: string;
  correo: string;
  nombre_completo: string;
  nombre_comercial: string;
}

async function procesarVentana(
  pool: Pool,
  ventanaInicio: Date,
  ventanaFin: Date,
  columna: 'recordatorio_24h' | 'recordatorio_1h',
  horasAntes: 24 | 1,
  appUrl: string
): Promise<number> {
  const { rows } = await pool.query<FilaCita>(`
    SELECT c.id, c.inicio, c.tipo,
           p.correo, p.nombre_completo,
           cl.nombre_comercial
    FROM   cita     c
    JOIN   paciente p  ON p.id  = c.paciente_id
    JOIN   clinica  cl ON cl.id = c.clinica_id
    WHERE  c.inicio BETWEEN $1 AND $2
      AND  c.estado NOT IN ('cancelada', 'realizada', 'no_asistio')
      AND  c.${columna} = false
  `, [ventanaInicio, ventanaFin]);

  for (const cita of rows) {
    await enviarRecordatorioCita({
      emailPaciente:  cita.correo,
      nombrePaciente: cita.nombre_completo,
      nombreClinica:  cita.nombre_comercial,
      fechaHora:      new Date(cita.inicio),
      tipoCita:       cita.tipo,
      horasAntes,
      appUrl,
    });
    // Marcar enviado inmediatamente tras el intento — incluso si Resend falló,
    // evita acumular reintentos en cada ciclo de 15 min
    await pool.query(
      `UPDATE cita SET ${columna} = true WHERE id = $1`,
      [cita.id]
    );
  }

  return rows.length;
}

export async function procesarRecordatorios(pool: Pool): Promise<void> {
  const appUrl = process.env.PAC_APP_URL ?? 'http://localhost:5175';
  const ahora  = new Date();

  // Ventana de 24 h: citas que empiezan entre 23 h y 25 h desde ahora
  const n24 = await procesarVentana(
    pool,
    new Date(ahora.getTime() + 23 * 3_600_000),
    new Date(ahora.getTime() + 25 * 3_600_000),
    'recordatorio_24h',
    24,
    appUrl
  );

  // Ventana de 1 h: citas que empiezan entre 55 min y 65 min desde ahora
  const n1 = await procesarVentana(
    pool,
    new Date(ahora.getTime() + 55 * 60_000),
    new Date(ahora.getTime() + 65 * 60_000),
    'recordatorio_1h',
    1,
    appUrl
  );

  if (n24 + n1 > 0) {
    console.log(`[AGE] Recordatorios enviados — 24h: ${n24}, 1h: ${n1}`);
  }
}
```

---

## Paso 4 — Registrar el cron en el servidor Fastify

Leer el archivo principal del servidor (`apps/api/src/server.ts` o `apps/api/src/app.ts`) para identificar dónde se inicializa el pool de PostgreSQL y dónde arrancar servicios secundarios. Agregar **después** de que el pool esté disponible y antes de `fastify.listen(...)`:

```typescript
import cron from 'node-cron';
import { procesarRecordatorios } from './agenda/recordatorios';

// Cada 15 minutos — frecuencia suficiente para la ventana de 55-65 min de 1h
cron.schedule('*/15 * * * *', async () => {
  try {
    await procesarRecordatorios(pool);
  } catch (err) {
    console.error('[AGE] Error en cron de recordatorios:', err);
  }
});
console.log('[AGE] Cron de recordatorios registrado (cada 15 min)');
```

> Usar la misma instancia `pool` que ya existe en el servidor — no crear una conexión nueva.

---

## Paso 5 — API: soportar rango de fechas en GET /api/citas

Leer `apps/api/src/agenda/routes.ts` (o donde viva el handler de `GET /api/citas`). Actualmente acepta `?semana=YYYY-WNN`. Agregar soporte para `?desde=ISO&hasta=ISO` sin romper el comportamiento existente:

```typescript
// Fragmento dentro del handler de GET /api/citas
const { semana, desde, hasta } = request.query as Record<string, string>;

let inicioPeriodo: Date;
let finPeriodo: Date;

if (desde && hasta) {
  // Vista mensual u otro rango arbitrario
  inicioPeriodo = new Date(desde);
  finPeriodo    = new Date(hasta);
} else if (semana) {
  // Lógica existente de YYYY-WNN — mantener intacta
  // ... (código actual)
} else {
  return reply.status(400).send({ error: 'Parámetro semana o (desde + hasta) requerido' });
}

const { rows } = await pool.query(`
  SELECT c.*,
         p.nombre_completo AS paciente_nombre,
         p.correo          AS paciente_correo
  FROM   cita     c
  JOIN   paciente p ON p.id = c.paciente_id
  WHERE  c.clinica_id = $1
    AND  c.inicio >= $2
    AND  c.inicio <= $3
  ORDER  BY c.inicio
`, [clinicaId, inicioPeriodo, finPeriodo]);

return reply.send(rows.map(r => ({
  ...r,
  paciente: { nombre_completo: r.paciente_nombre, correo: r.paciente_correo },
})));
```

---

## Paso 6 — Frontend: componente AgendaMensual

Crear `apps/web-professional/src/features/agenda/AgendaMensual.tsx`:

```tsx
import { useMemo } from 'react';

interface Cita {
  id: string;
  inicio: string;
  fin: string;
  tipo: string;
  estado: string;
  paciente?: { nombre_completo: string };
  paciente_id?: string;
}

const COLORES_ESTADO: Record<string, string> = {
  programada: 'bg-primary text-white',
  confirmada:  'bg-blue-500 text-white',
  realizada:   'bg-gray-400 text-white',
  cancelada:   'bg-red-300 text-white line-through',
  no_asistio:  'bg-orange-400 text-white',
};

interface Props {
  anio: number;
  mes: number; // 0-based (igual que Date)
  citas: Cita[];
  onDiaClick: (fecha: Date) => void;
  onCitaClick: (cita: Cita) => void;
}

export function AgendaMensual({ anio, mes, citas, onDiaClick, onCitaClick }: Props) {
  const { dias, citasPorDia } = useMemo(() => {
    const primerDia  = new Date(anio, mes, 1);
    const ultimoDia  = new Date(anio, mes + 1, 0);
    const dias: (Date | null)[] = [];

    // Relleno de inicio: semana empieza en lunes (0)
    const offsetInicio = (primerDia.getDay() + 6) % 7;
    for (let i = 0; i < offsetInicio; i++) dias.push(null);
    for (let d = 1; d <= ultimoDia.getDate(); d++) dias.push(new Date(anio, mes, d));

    // Relleno de fin para completar la última fila
    const resto = dias.length % 7;
    if (resto !== 0) for (let i = 0; i < 7 - resto; i++) dias.push(null);

    const citasPorDia = new Map<string, Cita[]>();
    for (const cita of citas) {
      const k = cita.inicio.slice(0, 10); // YYYY-MM-DD
      if (!citasPorDia.has(k)) citasPorDia.set(k, []);
      citasPorDia.get(k)!.push(cita);
    }

    return { dias, citasPorDia };
  }, [anio, mes, citas]);

  const hoy     = new Date();
  const esHoy   = (d: Date) =>
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth()    === hoy.getMonth()    &&
    d.getDate()     === hoy.getDate();

  const toKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return (
    <div className="bg-surface rounded-2xl border border-border overflow-hidden select-none">
      {/* Encabezado días de semana */}
      <div className="grid grid-cols-7 border-b border-border bg-surface-dim">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
          <div key={d} className="text-center text-xs font-semibold text-muted py-2">{d}</div>
        ))}
      </div>

      {/* Grilla de días */}
      <div className="grid grid-cols-7">
        {dias.map((dia, i) => {
          if (!dia) {
            return (
              <div
                key={`pad-${i}`}
                className="border-r border-b border-border bg-surface-dim min-h-[80px]"
              />
            );
          }

          const key           = toKey(dia);
          const citasDelDia   = citasPorDia.get(key) ?? [];
          const activas       = citasDelDia.filter(c => c.estado !== 'cancelada');
          const esFinDeSemana = dia.getDay() === 0 || dia.getDay() === 6;

          return (
            <div
              key={key}
              onClick={() => onDiaClick(dia)}
              className={[
                'border-r border-b border-border min-h-[80px] p-1 cursor-pointer',
                'hover:bg-surface-alt transition-colors',
                esHoy(dia)       ? 'bg-primary-tint'  : '',
                esFinDeSemana    ? 'bg-surface-dim/50' : '',
              ].join(' ')}
            >
              <span className={`text-xs font-semibold block mb-1 ${esHoy(dia) ? 'text-primary' : 'text-muted'}`}>
                {dia.getDate()}
              </span>

              {activas.slice(0, 3).map(cita => (
                <div
                  key={cita.id}
                  onClick={e => { e.stopPropagation(); onCitaClick(cita); }}
                  title={cita.paciente?.nombre_completo ?? cita.tipo}
                  className={[
                    'text-[10px] rounded px-1 py-0.5 mb-0.5 truncate cursor-pointer',
                    COLORES_ESTADO[cita.estado] ?? 'bg-gray-200 text-gray-700',
                  ].join(' ')}
                >
                  {new Date(cita.inicio).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  {' '}
                  {cita.paciente?.nombre_completo?.split(' ')[0] ?? cita.tipo}
                </div>
              ))}

              {activas.length > 3 && (
                <div className="text-[10px] text-muted font-semibold pl-1">
                  +{activas.length - 3} más
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

---

## Paso 7 — Toggle semana / mes en la página de agenda

Leer `apps/web-professional/src/pages/AgendaPage.tsx` (o el archivo donde vive `AgendaSemanal`) para entender la estructura actual antes de modificar.

Cambios a aplicar:

### 7a. Estado adicional

```typescript
const [vista, setVista] = useState<'semana' | 'mes'>('semana');

// Para la vista mensual derivar anio/mes desde el estado de semana actual
// El hook useAgenda ya maneja semanaActual como string YYYY-WNN
// Extraer la primera fecha de esa semana:
const primerDiaSemana = useMemo(() => {
  // Parsear YYYY-WNN a Date (lunes de esa semana)
  const [anioStr, wStr] = semanaActual.split('-W');
  const anio = parseInt(anioStr);
  const numSemana = parseInt(wStr);
  const enero1 = new Date(anio, 0, 1);
  const diasOffset = (numSemana - 1) * 7;
  const lunesIso = new Date(enero1.getTime() + diasOffset * 86_400_000);
  // Ajuste: enero1 puede no ser lunes
  const diaSemana = (enero1.getDay() + 6) % 7; // lunes=0
  lunesIso.setDate(lunesIso.getDate() - diaSemana);
  return lunesIso;
}, [semanaActual]);

const anioMes = primerDiaSemana.getFullYear();
const mesMes  = primerDiaSemana.getMonth();
```

### 7b. Carga de citas mensuales

```typescript
const [citasMes, setCitasMes] = useState<Cita[]>([]);

useEffect(() => {
  if (vista !== 'mes') return;
  const inicio = new Date(anioMes, mesMes, 1).toISOString();
  const fin    = new Date(anioMes, mesMes + 1, 0, 23, 59, 59).toISOString();
  fetch(`/api/citas?desde=${encodeURIComponent(inicio)}&hasta=${encodeURIComponent(fin)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(r => r.json())
    .then(setCitasMes)
    .catch(console.error);
}, [vista, anioMes, mesMes, token]);
```

### 7c. Botones de toggle y render condicional

Agregar los botones junto al selector de semana/fecha existente:

```tsx
<div className="flex items-center gap-2">
  <button
    onClick={() => setVista('semana')}
    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
      vista === 'semana'
        ? 'bg-primary text-white'
        : 'bg-surface-alt text-muted hover:text-foreground'
    }`}
  >
    Semana
  </button>
  <button
    onClick={() => setVista('mes')}
    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
      vista === 'mes'
        ? 'bg-primary text-white'
        : 'bg-surface-alt text-muted hover:text-foreground'
    }`}
  >
    Mes
  </button>
</div>
```

Render condicional:

```tsx
{vista === 'semana' ? (
  <AgendaSemanal
    citas={citas}
    semana={semanaActual}
    onCitaClick={abrirModal}
    onSlotClick={abrirFormNueva}
  />
) : (
  <AgendaMensual
    anio={anioMes}
    mes={mesMes}
    citas={citasMes}
    onDiaClick={dia => {
      // Navegar a esa semana en vista semanal
      const isoWeek = toISOWeek(dia); // helper YYYY-WNN
      setSemanaActual(isoWeek);
      setVista('semana');
    }}
    onCitaClick={abrirModal}
  />
)}
```

El helper `toISOWeek(date: Date): string` — si no existe, crearlo junto al hook:

```typescript
function toISOWeek(date: Date): string {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const semana1 = new Date(d.getFullYear(), 0, 4);
  const numSemana = 1 + Math.round(((d.getTime() - semana1.getTime()) / 86_400_000 - 3 + ((semana1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(numSemana).padStart(2, '0')}`;
}
```

---

## Paso 8 — Enlace cita → consulta en ModalCita

Leer `apps/web-professional/src/features/agenda/ModalCita.tsx` para ver la estructura actual antes de modificar.

Agregar el botón "Iniciar consulta" dentro del modal, visible cuando la cita está en un estado que permite abrir una consulta:

```tsx
// Condición: la cita fue confirmada o es hoy/pasado y sigue programada
const puedeIniciarConsulta =
  cita.estado === 'confirmada' ||
  (cita.estado === 'programada' && new Date(cita.inicio) <= new Date());

{puedeIniciarConsulta && (
  <button
    onClick={() => {
      onClose();
      navigate(`/pacientes/${cita.paciente_id}/consultas/nueva?cita_id=${cita.id}`);
    }}
    className="w-full mt-3 py-2.5 px-4 bg-primary text-white rounded-xl font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
  >
    <span>Iniciar consulta</span>
  </button>
)}
```

> Leer el archivo de creación de consultas del flujo EVAL (`/pacientes/:id/consultas/nueva`) para verificar que acepta `?cita_id` en la query. Si lo acepta: mostrar un banner "Consulta vinculada a la cita del {fecha}". Si no: solo navegar sin el param — el vínculo quedará pendiente para r22.

Tras crear la consulta, si el flujo EVAL llama a `POST /api/pacientes/:id/consultas` y el cuerpo incluye el `cita_id`, agregar en ese endpoint:

```typescript
// Solo si cita_id viene en el body y es UUID válido
if (body.cita_id) {
  await pool.query(
    `UPDATE cita
     SET estado = 'realizada', updated_at = now()
     WHERE id = $1 AND clinica_id = $2 AND estado NOT IN ('cancelada', 'realizada')`,
    [body.cita_id, clinicaId]
  );
}
```

No modificar el schema de `consulta` — la vinculación explícita queda para r22 si se necesita trazabilidad bidireccional.

---

## Paso 9 — Confirmación de cita desde la app del paciente

### 9a. Endpoint Fastify

En `apps/api/src/agenda/routes.ts`, agregar:

```typescript
// PATCH /api/paciente/citas/:id/confirmar
fastify.patch('/api/paciente/citas/:id/confirmar', {
  onRequest: [fastify.authenticate],
}, async (request, reply) => {
  const { id } = request.params as { id: string };
  const sub    = (request.user as { sub: string }).sub;

  const { rows: [paciente] } = await pool.query<{ id: string; clinica_id: string }>(
    'SELECT id, clinica_id FROM paciente WHERE keycloak_user_id = $1',
    [sub]
  );
  if (!paciente) return reply.status(404).send({ error: 'Paciente no encontrado' });

  const { rows: [cita] } = await pool.query<{ id: string; estado: string }>(
    `UPDATE cita
     SET    estado = 'confirmada', updated_at = now()
     WHERE  id = $1
       AND  paciente_id = $2
       AND  clinica_id  = $3
       AND  estado = 'programada'
       AND  inicio > now()
     RETURNING id, estado`,
    [id, paciente.id, paciente.clinica_id]
  );

  if (!cita) return reply.status(404).send({ error: 'Cita no encontrada o no confirmable' });

  return reply.send(cita);
});
```

### 9b. Botón en la app del paciente

Leer `apps/web-patient/src/pages/Citas.tsx` (o el componente que muestra la próxima cita del paciente, creado en r20) para ver la estructura actual. Agregar:

```tsx
const confirmarCita = async (citaId: string) => {
  const res = await fetch(`/api/paciente/citas/${citaId}/confirmar`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[PAC] confirmar cita:', err);
    return;
  }
  await fetchCitas(); // recargar estado
};

// En el JSX, dentro de la tarjeta de la próxima cita:
{proximaCita?.estado === 'programada' && new Date(proximaCita.inicio) > new Date() && (
  <button
    onClick={() => confirmarCita(proximaCita.id)}
    className="mt-3 w-full py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity"
  >
    Confirmar asistencia
  </button>
)}

{proximaCita?.estado === 'confirmada' && (
  <div className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold text-primary">
    <span>✓</span>
    <span>Asistencia confirmada</span>
  </div>
)}
```

---

## Paso 10 — Verificación

```bash
# 1. Cron registrado en el arranque
docker compose -f infra/docker-compose.dev.yml logs api | grep "Cron de recordatorios"
# Debe mostrar: [AGE] Cron de recordatorios registrado (cada 15 min)

# 2. Disparo manual del procesador (sin esperar 15 min)
# Abrir el REPL de Node o agregar un endpoint temporal de debug en DEV:
# GET /api/debug/recordatorios (solo si NODE_ENV !== 'production')
# Que llame await procesarRecordatorios(pool) y devuelva "ok"

# 3. Vista mensual — abrir http://localhost:5173/agenda
# - Hacer clic en "Mes" → debe mostrar la grilla del mes actual
# - Las citas existentes deben aparecer como chips de colores en sus días
# - Hacer clic en un día → debe navegar a la vista semanal de esa semana

# 4. Confirmación de cita — abrir http://localhost:5175
# - Con una cita en estado 'programada' futura, aparece "Confirmar asistencia"
# - Al presionar, el estado cambia a 'confirmada' y aparece el tick verde
# - En la agenda profesional, la cita muestra estado 'confirmada' (color azul)

# 5. Iniciar consulta — abrir ModalCita de una cita confirmada
# - Aparece el botón "Iniciar consulta"
# - Al presionar, navega a la ruta de nueva consulta con ?cita_id=... en la URL
```

---

## Notas para r22

- **Disponibilidad del profesional**: nueva tabla `horario_profesional` con franjas por día de semana; `FormNuevaCita` solo permite slots dentro del horario
- **Vista de día**: clic en un día del mes abre una lista vertical de citas de ese día sin cambiar a vista semanal
- **Trazabilidad cita ↔ consulta**: columna `cita_id UUID REFERENCES cita(id)` en la tabla `consulta` (migration 022); el endpoint de nueva consulta ya recibe el param pero aún no lo persiste
- **Deduplicación de notificaciones**: rebanada AGE comparte el mismo patrón que COM — definir política global en r22 cuando ambos lados tengan el mismo comportamiento
- **Push notifications (WebPush)**: alternativa a email para pacientes que tengan el PWA instalado en home screen
