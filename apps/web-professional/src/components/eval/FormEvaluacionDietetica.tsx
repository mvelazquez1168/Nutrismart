/**
 * Evaluación Dietética — R50, primera subcarpeta de Dietético.
 *
 * Catorce preguntas sobre cómo come el paciente: cuántos tiempos hace,
 * dónde y quién cocina, qué grasas usa, cómo cocina, qué agrega a la
 * mesa, qué dietas hizo, cuánta agua toma, y los dos campos abiertos
 * —alimentos que no consume y preferidos— que se reflejan en Prescripción.
 *
 * ── Tres cosas del diseño de este formulario ────────────────────────
 *
 * **1. Los sí/no tienen tres estados, no dos.** «Sin responder» es
 * distinto de «No», y el formulario lo deja ver: los dos radios nacen
 * vacíos y hay un botón para volver a vaciarlos. Si un «No» fuera el
 * estado inicial, el expediente diría que el paciente no agrega sal
 * porque nadie le preguntó.
 *
 * **2. El contenido no se guarda aquí.** Como el resto de las
 * subcarpetas de Dietético, el estado vive en `TabsDietetico` y se
 * guarda en UNA petición con todo lo demás: guardar por partes dejaría
 * media evaluación si la red falla a mitad.
 *
 * **3. La cantidad de agua se habilita con el sí.** Un «No consume agua
 * diariamente» con una cantidad escrita al lado es una contradicción que
 * el formulario no debería permitir escribir.
 */
import { Campo, claseControl } from '../Campo'

/** Lo que este formulario guarda. Las claves son las de la API. */
export interface Habitos {
  tiemposPorDia: string | null
  tiemposRealizados: string[]
  lugarComidas: string | null
  quienPrepara: string
  apetito: string | null
  grasasCocinar: string
  tiposCoccion: string[]
  agregaSal: boolean | null
  consumeAzucar: boolean | null
  usaEdulcorante: boolean | null
  dietasRealizadas: string
  consumeAgua: boolean | null
  cantidadAgua: string
  alimentosNoConsume: string
  alimentosPreferidos: string
}

export const HABITOS_VACIOS: Habitos = {
  tiemposPorDia: null,
  tiemposRealizados: [],
  lugarComidas: null,
  quienPrepara: '',
  apetito: null,
  grasasCocinar: '',
  tiposCoccion: [],
  agregaSal: null,
  consumeAzucar: null,
  usaEdulcorante: null,
  dietasRealizadas: '',
  consumeAgua: null,
  cantidadAgua: '',
  alimentosNoConsume: '',
  alimentosPreferidos: '',
}

const TIEMPOS_POR_DIA = [
  { valor: '1-2', etiqueta: '1 – 2' },
  { valor: '3-5', etiqueta: '3 – 5' },
  { valor: '6+', etiqueta: '6 o más' },
]

// Las claves son las mismas del plan alimentario y del enum de la base:
// si no coincidieran, el plan y la evaluación hablarían de desayunos
// distintos.
const TIEMPOS = [
  { valor: 'desayuno', etiqueta: 'Desayuno' },
  { valor: 'merienda_am', etiqueta: 'Merienda mañana' },
  { valor: 'almuerzo', etiqueta: 'Almuerzo' },
  { valor: 'merienda_pm', etiqueta: 'Merienda tarde' },
  { valor: 'cena', etiqueta: 'Cena' },
  { valor: 'colacion_nocturna', etiqueta: 'Colación nocturna' },
]

const LUGARES = [
  { valor: 'casa', etiqueta: 'Casa' },
  { valor: 'fuera', etiqueta: 'Fuera' },
  { valor: 'otro', etiqueta: 'Otro' },
]

const APETITOS = [
  { valor: 'bueno', etiqueta: 'Bueno' },
  { valor: 'regular', etiqueta: 'Regular' },
  { valor: 'malo', etiqueta: 'Malo' },
]

const COCCIONES = [
  { valor: 'asado', etiqueta: 'Asado' },
  { valor: 'fritura', etiqueta: 'Fritura' },
  { valor: 'hervido', etiqueta: 'Hervido' },
  { valor: 'plancha', etiqueta: 'A la plancha' },
  { valor: 'vapor', etiqueta: 'Al vapor' },
]

/* ------------------------------------------------------------------ */
/* Controles                                                           */
/* ------------------------------------------------------------------ */

function Pregunta({
  titulo,
  ayuda,
  children,
}: {
  titulo: string
  ayuda?: string
  children: React.ReactNode
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium text-ink">{titulo}</legend>
      {children}
      {ayuda && <p className="mt-1 text-xs text-muted">{ayuda}</p>}
    </fieldset>
  )
}

function Radios({
  nombre,
  opciones,
  valor,
  onCambio,
  bloqueada,
}: {
  nombre: string
  opciones: { valor: string; etiqueta: string }[]
  valor: string | null
  onCambio: (v: string | null) => void
  bloqueada: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {opciones.map((o) => (
        <label key={o.valor} className="flex items-center gap-1.5 text-sm text-ink">
          <input
            type="radio"
            name={nombre}
            value={o.valor}
            checked={valor === o.valor}
            onChange={() => onCambio(o.valor)}
            disabled={bloqueada}
            className="h-4 w-4 accent-[color:var(--primary)]"
          />
          {o.etiqueta}
        </label>
      ))}

      {/*
        Volver a «sin responder».
        Un grupo de radios no se puede desmarcar con el teclado ni con el
        ratón, así que sin este botón una respuesta puesta por error queda
        en el expediente para siempre.
      */}
      {valor !== null && !bloqueada && (
        <button
          type="button"
          onClick={() => onCambio(null)}
          className="text-xs text-muted underline hover:text-ink"
        >
          Sin responder
        </button>
      )}
    </div>
  )
}

function SiNo({
  nombre,
  valor,
  onCambio,
  bloqueada,
}: {
  nombre: string
  valor: boolean | null
  onCambio: (v: boolean | null) => void
  bloqueada: boolean
}) {
  return (
    <Radios
      nombre={nombre}
      opciones={[
        { valor: 'si', etiqueta: 'Sí' },
        { valor: 'no', etiqueta: 'No' },
      ]}
      valor={valor === null ? null : valor ? 'si' : 'no'}
      onCambio={(v) => onCambio(v === null ? null : v === 'si')}
      bloqueada={bloqueada}
    />
  )
}

function Casillas({
  opciones,
  valores,
  onCambio,
  bloqueada,
}: {
  opciones: { valor: string; etiqueta: string }[]
  valores: string[]
  onCambio: (v: string[]) => void
  bloqueada: boolean
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {opciones.map((o) => (
        <label key={o.valor} className="flex items-center gap-1.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={valores.includes(o.valor)}
            onChange={() =>
              // Se reconstruye en el orden declarado, no en el orden en
              // que se fue marcando: la misma respuesta tiene que leerse
              // igual siempre. El servidor hace lo mismo.
              onCambio(
                opciones
                  .map((x) => x.valor)
                  .filter((v) =>
                    v === o.valor ? !valores.includes(o.valor) : valores.includes(v),
                  ),
              )
            }
            disabled={bloqueada}
            className="h-4 w-4 rounded accent-[color:var(--primary)]"
          />
          {o.etiqueta}
        </label>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El formulario                                                       */
/* ------------------------------------------------------------------ */

export function FormEvaluacionDietetica({
  datos,
  onCambio,
  bloqueada,
}: {
  datos: Habitos
  onCambio: (d: Habitos) => void
  bloqueada: boolean
}) {
  const set = <K extends keyof Habitos>(clave: K, valor: Habitos[K]) =>
    onCambio({ ...datos, [clave]: valor })

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Hábitos alimentarios del paciente. Se guardan con el resto de la evaluación dietética y se
        actualizan consulta a consulta.
      </p>

      {/* ---- Tiempos de comida ---- */}
      <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Tiempos de comida</h3>

        <Pregunta titulo="¿Cuántos tiempos de comida realiza al día normalmente?">
          <Radios
            nombre="tiempos-por-dia"
            opciones={TIEMPOS_POR_DIA}
            valor={datos.tiemposPorDia}
            onCambio={(v) => set('tiemposPorDia', v)}
            bloqueada={bloqueada}
          />
        </Pregunta>

        <Pregunta titulo="Indique cuáles realiza" ayuda="Puede marcar varios.">
          <Casillas
            opciones={TIEMPOS}
            valores={datos.tiemposRealizados}
            onCambio={(v) => set('tiemposRealizados', v)}
            bloqueada={bloqueada}
          />
        </Pregunta>
      </section>

      {/* ---- Entorno y preparación ---- */}
      <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Entorno y preparación</h3>

        <Pregunta titulo="¿Dónde consume la mayor parte de sus comidas?">
          <Radios
            nombre="lugar-comidas"
            opciones={LUGARES}
            valor={datos.lugarComidas}
            onCambio={(v) => set('lugarComidas', v)}
            bloqueada={bloqueada}
          />
        </Pregunta>

        <Campo id="quien-prepara" etiqueta="¿Quién prepara sus comidas generalmente?">
          <input
            id="quien-prepara"
            type="text"
            value={datos.quienPrepara}
            onChange={(e) => set('quienPrepara', e.target.value)}
            disabled={bloqueada}
            maxLength={200}
            placeholder="Ella misma, su pareja, servicio de comidas…"
            className={claseControl(false)}
          />
        </Campo>

        <Pregunta titulo="¿Cómo calificaría su apetito?">
          <Radios
            nombre="apetito"
            opciones={APETITOS}
            valor={datos.apetito}
            onCambio={(v) => set('apetito', v)}
            bloqueada={bloqueada}
          />
        </Pregunta>

        <Campo
          id="grasas-cocinar"
          etiqueta="Tipo de grasas que utiliza regularmente para cocinar"
        >
          <input
            id="grasas-cocinar"
            type="text"
            value={datos.grasasCocinar}
            onChange={(e) => set('grasasCocinar', e.target.value)}
            disabled={bloqueada}
            maxLength={300}
            placeholder="Aceite de oliva, manteca, aceite vegetal…"
            className={claseControl(false)}
          />
        </Campo>

        <Pregunta titulo="Tipos de cocción preferida" ayuda="Puede marcar varios.">
          <Casillas
            opciones={COCCIONES}
            valores={datos.tiposCoccion}
            onCambio={(v) => set('tiposCoccion', v)}
            bloqueada={bloqueada}
          />
        </Pregunta>
      </section>

      {/* ---- Agregados a la mesa ---- */}
      <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Agregados y endulzantes</h3>

        <Pregunta titulo="¿Agrega sal a la comida ya preparada?">
          <SiNo
            nombre="agrega-sal"
            valor={datos.agregaSal}
            onCambio={(v) => set('agregaSal', v)}
            bloqueada={bloqueada}
          />
        </Pregunta>

        <Pregunta titulo="¿Consume azúcar?">
          <SiNo
            nombre="consume-azucar"
            valor={datos.consumeAzucar}
            onCambio={(v) => set('consumeAzucar', v)}
            bloqueada={bloqueada}
          />
        </Pregunta>

        <Pregunta titulo="¿Utiliza algún edulcorante?">
          <SiNo
            nombre="usa-edulcorante"
            valor={datos.usaEdulcorante}
            onCambio={(v) => set('usaEdulcorante', v)}
            bloqueada={bloqueada}
          />
        </Pregunta>
      </section>

      {/* ---- Antecedentes e hidratación ---- */}
      <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Antecedentes e hidratación</h3>

        <Campo id="dietas-realizadas" etiqueta="¿Ha realizado algún tipo de dieta? ¿Qué tipo?">
          <input
            id="dietas-realizadas"
            type="text"
            value={datos.dietasRealizadas}
            onChange={(e) => set('dietasRealizadas', e.target.value)}
            disabled={bloqueada}
            maxLength={1000}
            placeholder="Keto hace dos años, ayuno intermitente…"
            className={claseControl(false)}
          />
        </Campo>

        <Pregunta titulo="¿Consume agua diariamente? ¿Cuánta?">
          <div className="space-y-2">
            <SiNo
              nombre="consume-agua"
              valor={datos.consumeAgua}
              onCambio={(v) =>
                // Al responder «No», la cantidad se borra: «no consume
                // agua, 2 litros» es una contradicción que no debería
                // poder quedar guardada.
                onCambio({
                  ...datos,
                  consumeAgua: v,
                  cantidadAgua: v === true ? datos.cantidadAgua : '',
                })
              }
              bloqueada={bloqueada}
            />
            <input
              id="cantidad-agua"
              type="text"
              value={datos.cantidadAgua}
              onChange={(e) => set('cantidadAgua', e.target.value)}
              disabled={bloqueada || datos.consumeAgua !== true}
              maxLength={100}
              placeholder="Cantidad: 2 litros, 6 vasos…"
              aria-label="Cantidad de agua que consume"
              className={`${claseControl(false)} sm:max-w-xs`}
            />
          </div>
        </Pregunta>
      </section>

      {/* ---- Preferencias y rechazos ---- */}
      <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Preferencias y rechazos</h3>
        <p className="text-xs text-muted">
          Estos dos campos se muestran también en la carpeta Prescripción, debajo de las alergias:
          es donde hacen falta al escribir el plan.
        </p>

        <Campo id="alimentos-no-consume" etiqueta="Alimentos que no consume y por qué razón">
          <textarea
            id="alimentos-no-consume"
            value={datos.alimentosNoConsume}
            onChange={(e) => set('alimentosNoConsume', e.target.value)}
            disabled={bloqueada}
            maxLength={2000}
            rows={4}
            placeholder="Hígado, le desagrada el sabor. Cerdo, por creencia religiosa."
            className={claseControl(false)}
          />
        </Campo>

        <Campo id="alimentos-preferidos" etiqueta="Alimentos preferidos">
          <textarea
            id="alimentos-preferidos"
            value={datos.alimentosPreferidos}
            onChange={(e) => set('alimentosPreferidos', e.target.value)}
            disabled={bloqueada}
            maxLength={2000}
            rows={4}
            placeholder="Pescado, arroz, frutas cítricas…"
            className={claseControl(false)}
          />
        </Campo>
      </section>
    </div>
  )
}
