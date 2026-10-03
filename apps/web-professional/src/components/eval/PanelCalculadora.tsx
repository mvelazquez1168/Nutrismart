/**
 * Calculadora de requerimiento energético y distribución de dieta —
 * EVAL-06 / R39 / R42.
 *
 * Panel lateral sobre la valoración, en dos secciones:
 *   A. Antropometría + requerimiento energético, con estructura corporal,
 *      IMC y pesos ideales. El total fluye a la Sección B.
 *
 *      Hay dos caminos para llegar a ese total, y no se mezclan:
 *        · Schofield, Mifflin, FAO/OMS y Harris-Benedict parten del peso
 *          y multiplican: VET = GEB × (FA + FT + FE − 2).
 *        · Cunningham (R42) parte de la masa libre de grasa y SUMA:
 *          GET = GER × 1.1 + GEE, donde el GEE se detalla actividad por
 *          actividad. Con este método los factores FA/FT/FE desaparecen
 *          —contarían el ejercicio dos veces— y aparece la lectura de
 *          disponibilidad energética (RED-S).
 *   B. Distribución de dieta por listas de intercambio (ADA, INCIENSA;
 *      la Colombiana queda informativa a falta de composición por grupo).
 *      Los cortes son sugerencias; el total usa las porciones digitadas.
 *
 * Todo se calcula en el cliente. Los datos del paciente se precargan de
 * la última medición y del expediente, y quedan editables.
 *
 * Al aplicar devuelve `DatosCalculadora` al formulario de conclusiones.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ACTIVIDAD_LIBRE,
  CATALOGO_ACTIVIDADES,
  METODOS_GEB,
  METODOS_DIETA,
  METODOS_DIETA_OFRECIDOS,
  metodosOfrecidos,
  azucarLibreCdas,
  salCdtas,
  SODIO_OFRECIDO,
  MICRONUTRIENTES_COLOMBIANA,
  ETIQUETA_ESTRUCTURA,
  calcularDistribucion,
  calcularGEE,
  calcularGeb,
  calcularSal,
  disponibilidadEnergetica,
  getCunningham,
  interpretarDE,
  requiereMlg,
  usaFactoresActividad,
  clasificarEstructura,
  clasificarImc,
  generoDeSexo,
  imc as calcularImc,
  indiceEstructura,
  macrosMeta,
  pesoAjustado,
  pesoMetaPorImc,
  piADA,
  piAdultoMayor,
  piEncamado,
  piFecImc,
  piLorentz,
  tallaDesdeRodilla,
  vetConFactores,
  type DatosCalculadora,
  type EntradaGEE,
  type Estructura,
  type Genero,
  type LineaIntercambio,
  type MetodoDietaClave,
  type MetodoGeb,
} from '../../lib/calculadoraNutricion'
import { getMediciones, type Medicion } from '../../api/valoracion'

export type { DatosCalculadora }

/* ---- utilidades de estado numérico ---- */

const num = (s: string): number | null => {
  if (s.trim() === '') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Una fila de la tabla GEE mientras se edita.
 *
 * Los números viven como texto: borrar un campo pasa por la cadena
 * vacía, y convertirla a 0 pondría un cero donde se está a medio
 * escribir. El GEE no se guarda aquí — se deriva en cada render, así no
 * hay dos verdades que sincronizar.
 */
interface FilaGEE {
  id: string
  actividad: string
  mets: string
  kg: string
  minutos: string
}

/** Ids de fila. `randomUUID` no existe fuera de contextos seguros. */
let secuenciaGee = 0
function idGee(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  secuenciaGee += 1
  return `gee-${secuenciaGee}`
}

/* ---- piezas visuales ---- */

const CTRL_EDITABLE =
  'w-full rounded-md border border-border bg-surface p-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]'

function CampoNum({
  id,
  etiqueta,
  valor,
  onChange,
  ayuda,
  paso,
}: {
  id: string
  etiqueta: string
  valor: string
  onChange: (v: string) => void
  ayuda?: string
  paso?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-xs font-medium text-ink">
        {etiqueta}
        {ayuda && <span className="ml-1 font-normal text-muted">· {ayuda}</span>}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={paso ?? 'any'}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={CTRL_EDITABLE}
      />
    </div>
  )
}

/** Valor calculado, solo lectura: fondo distinto y candado. */
function Lectura({ etiqueta, valor, resaltar }: { etiqueta: string; valor: ReactNode; resaltar?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-2 rounded-md px-2 py-1 ${
        resaltar ? 'bg-primary-tint' : 'bg-surface-2'
      }`}
    >
      <span className="flex items-center gap-1 text-xs text-muted">
        <span aria-hidden="true">🔒</span>
        {etiqueta}
      </span>
      <span className={`text-sm font-semibold tabular-nums ${resaltar ? 'text-primary' : 'text-ink'}`}>
        {valor}
      </span>
    </div>
  )
}

function BadgeEstructura({ estructura }: { estructura: Estructura }) {
  // Verde = mediana; amarillo = pequeña o grande (R39 §UX).
  const color = estructura === 'mediana' ? 'var(--status-normal)' : 'var(--status-alert)'
  return (
    <span
      className="rounded-pill px-2 py-0.5 text-xs font-semibold"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      {ETIQUETA_ESTRUCTURA[estructura]}
    </span>
  )
}

function Titulo({ children }: { children: ReactNode }) {
  return <h3 className="border-b border-border pb-1 text-sm font-bold text-ink">{children}</h3>
}

export function PanelCalculadora({
  abierto,
  pacienteId,
  edad,
  sexo,
  fafHistorial,
  datosGuardados,
  onCerrar,
  onEnviar,
}: {
  abierto: boolean
  pacienteId: string
  edad: number | null
  sexo: string | null
  /** Factor de actividad que ya está en el historial clínico, si existe. */
  fafHistorial: number | null
  /** Lo aplicado en una sesión anterior; prevalece sobre el expediente. */
  datosGuardados?: DatosCalculadora | null
  onCerrar: () => void
  onEnviar: (r: DatosCalculadora) => void
}) {
  const [medicion, setMedicion] = useState<Medicion | null>(null)
  const [cargandoDatos, setCargandoDatos] = useState(false)
  // true tras precargar del expediente; se apaga al editar un dato hidratado.
  const [hidratado, setHidratado] = useState(false)

  /* ---- Sección A: entradas ---- */
  const [genero, setGenero] = useState<Genero | null>(generoDeSexo(sexo))
  const [edadStr, setEdadStr] = useState(edad !== null ? String(edad) : '')
  const [pesoActual, setPesoActual] = useState('')
  const [pesoUsual, setPesoUsual] = useState('')
  const [tallaStr, setTallaStr] = useState('')
  const [rodilla, setRodilla] = useState('')
  const [muneca, setMuneca] = useState('')
  const [braquial, setBraquial] = useState('')
  const [abdominal, setAbdominal] = useState('')
  const [cadera, setCadera] = useState('')
  const [pctGrasa, setPctGrasa] = useState('')
  const [mlg, setMlg] = useState('')

  const [metodoGeb, setMetodoGeb] = useState<MetodoGeb>('mifflin')
  const [pal, setPal] = useState(fafHistorial !== null ? String(fafHistorial) : '1.3')
  const [ft, setFt] = useState('1')
  const [fe, setFe] = useState('1')
  /** Actividades del día. Solo se usan con Cunningham (R42). */
  const [geeFilas, setGeeFilas] = useState<FilaGEE[]>([])

  const [pesoUtilizar, setPesoUtilizar] = useState('')
  const [piUtilizar, setPiUtilizar] = useState('')
  const [imcDeseado, setImcDeseado] = useState('')

  /* ---- Sección B: distribución ---- */
  const [metodoDieta, setMetodoDieta] = useState<MetodoDietaClave>('ADA')
  const [choPct, setChoPct] = useState('50')
  const [protPct, setProtPct] = useState('20')
  const [grasaPct, setGrasaPct] = useState('30')
  const [reqDieta, setReqDieta] = useState('')
  const [porciones, setPorciones] = useState<Record<string, number>>({})
  const [naRecomendado, setNaRecomendado] = useState('')
  const [naAportado, setNaAportado] = useState('')
  /** Meta de sodio elegida, en mg/día (R44). null = sin elegir. */
  const [sodioMg, setSodioMg] = useState<number | null>(null)

  // Precarga de la última medición. No bloquea: el panel se muestra ya y
  // los datos entran cuando llega el fetch.
  useEffect(() => {
    if (!abierto) return
    const ctrl = new AbortController()
    setCargandoDatos(true)
    getMediciones(pacienteId, 1, ctrl.signal)
      .then((lista) => {
        if (!ctrl.signal.aborted) setMedicion(lista[0] ?? null)
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setCargandoDatos(false)
      })
    return () => ctrl.abort()
  }, [abierto, pacienteId])

  // Antropometría del expediente: peso, talla, % grasa y circunferencias.
  // Solo rellena campos vacíos (no pisa lo que el profesional ya escribió,
  // ni lo hidratado de una sesión anterior). Marca «cargado del expediente».
  useEffect(() => {
    if (!medicion) return
    const set = (setter: (u: (v: string) => string) => void, valor: number | null | undefined) => {
      if (valor == null) return
      setter((v) => (v === '' ? String(valor) : v))
    }
    set(setPesoActual, medicion.pesoKg)
    set(setTallaStr, medicion.tallaCm)
    set(setPctGrasa, medicion.pctGrasa)
    set(setAbdominal, medicion.cinturaCm)
    set(setCadera, medicion.caderaCm)
    set(setBraquial, medicion.brazoCm)
    // La MLG medida manda sobre la derivada del % de grasa: viene de
    // bioimpedancia o pliegues, no de una resta (R42).
    set(setMlg, medicion.masaLibreGrasaKg)
    const hayAlgo =
      medicion.pesoKg != null ||
      medicion.tallaCm != null ||
      medicion.pctGrasa != null ||
      medicion.cinturaCm != null ||
      medicion.caderaCm != null ||
      medicion.brazoCm != null
    if (hayAlgo) setHidratado(true)
  }, [medicion])

  // Prioridad: lo aplicado antes (datosGuardados) prevalece sobre el
  // expediente para la Sección B. Se hidrata al abrir.
  useEffect(() => {
    if (!abierto || !datosGuardados) return
    // Método, MLG y actividades (R42). Ausentes en lo guardado antes de
    // la R42: entonces no se tocan y queda el estado por defecto.
    if (datosGuardados.metodoGer) setMetodoGeb(datosGuardados.metodoGer)
    if (datosGuardados.mlgKg != null) setMlg(String(datosGuardados.mlgKg))
    if (datosGuardados.geeEntradas?.length) {
      setGeeFilas(
        datosGuardados.geeEntradas.map((e) => ({
          id: e.id || idGee(),
          actividad: e.actividad,
          mets: String(e.mets),
          kg: String(e.kg),
          minutos: String(e.minutos),
        })),
      )
    }
    setMetodoDieta(datosGuardados.metodoDieta)
    setReqDieta(String(datosGuardados.metaCalorica))
    setChoPct(String(datosGuardados.distribucionMacros.choPct))
    setProtPct(String(datosGuardados.distribucionMacros.protPct))
    setGrasaPct(String(datosGuardados.distribucionMacros.grasaPct))
    const porEtiqueta = new Map(
      METODOS_DIETA[datosGuardados.metodoDieta].grupos.map((g) => [g.etiqueta, g.clave]),
    )
    const p: Record<string, number> = {}
    for (const l of datosGuardados.listasIntercambio) {
      const clave = porEtiqueta.get(l.grupo)
      if (clave) p[clave] = l.porciones
    }
    setPorciones(p)
    // Ausente en lo guardado antes de la R44: se queda sin elegir.
    if (datosGuardados.sodioMg != null) setSodioMg(datosGuardados.sodioMg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, datosGuardados])

  useEffect(() => {
    if (fafHistorial !== null) setPal((p) => (p === '' ? String(fafHistorial) : p))
  }, [fafHistorial])

  /* ---- Derivados de la Sección A ---- */
  const edadN = num(edadStr)
  const pesoActualN = num(pesoActual)
  const tallaManual = num(tallaStr)
  const rodillaN = num(rodilla)
  const munecaN = num(muneca)
  const braquialN = num(braquial)

  // FAO/OMS solo para ≤ 18 años. Si la edad sube por encima con FAO/OMS
  // activo, se pasa a Schofield.
  const faoDisponible = edadN !== null && edadN <= 18
  const metodosGeb = METODOS_GEB.filter((m) => m.clave !== 'fao_oms' || faoDisponible)
  useEffect(() => {
    if (metodoGeb === 'fao_oms' && !faoDisponible) setMetodoGeb('schofield')
  }, [metodoGeb, faoDisponible])

  // Talla: la escrita, o la estimada desde la altura de rodilla.
  const tallaEstimada =
    tallaManual === null && rodillaN !== null && edadN !== null && genero !== null
      ? tallaDesdeRodilla(rodillaN, edadN, genero)
      : null
  const talla = tallaManual ?? tallaEstimada
  const tallaM = talla !== null ? talla / 100 : null

  const indice = talla !== null && munecaN !== null && munecaN > 0 ? indiceEstructura(talla, munecaN) : null
  const estructura: Estructura | null =
    indice !== null && genero !== null ? clasificarEstructura(indice, genero) : null

  const imcVal = pesoActualN !== null && talla !== null ? calcularImc(pesoActualN, talla) : null

  const piAda = talla !== null && genero !== null ? piADA(talla, genero) : null
  const piFec = tallaM !== null ? piFecImc(tallaM) : null
  const piAm = tallaM !== null ? piAdultoMayor(tallaM) : null
  const piLor = talla !== null && genero !== null ? piLorentz(talla, genero) : null
  const piEnc =
    rodillaN !== null && braquialN !== null && genero !== null
      ? piEncamado(rodillaN, braquialN, genero)
      : null

  // PI ADA sugerido según la estructura calculada.
  const piAdaSugerido =
    piAda && estructura ? (estructura === 'pequena' ? piAda.pequena : estructura === 'grande' ? piAda.grande : piAda.mediana) : null

  const piUtilN = num(piUtilizar)
  const pesoUtilN = num(pesoUtilizar)
  const pAjustado = pesoActualN !== null && piUtilN !== null ? pesoAjustado(pesoActualN, piUtilN) : null
  const pMetaImc = num(imcDeseado) !== null && tallaM !== null ? pesoMetaPorImc(num(imcDeseado) as number, tallaM) : null

  /* ---- Masa libre de grasa (R42) ----
   *
   * Lo escrito manda. Si no hay nada escrito se deriva del peso y el % de
   * grasa, que es la cuenta que haría el profesional a mano. Se deriva en
   * vez de rellenar el campo para que se vea de dónde sale: un número que
   * aparece solo en una casilla editable no se distingue de uno medido.
   */
  const pctGrasaN = num(pctGrasa)
  const mlgEscrita = num(mlg)
  const mlgDerivada =
    mlgEscrita === null && pesoActualN !== null && pctGrasaN !== null && pctGrasaN > 0 && pctGrasaN < 100
      ? round1(pesoActualN * (1 - pctGrasaN / 100))
      : null
  const mlgN = mlgEscrita ?? mlgDerivada

  const esCunningham = requiereMlg(metodoGeb)
  const conFactores = usaFactoresActividad(metodoGeb)

  const geb = useMemo(
    () => calcularGeb({ metodo: metodoGeb, peso: pesoUtilN, talla, edad: edadN, genero, mlg: mlgN }),
    [metodoGeb, pesoUtilN, talla, edadN, genero, mlgN],
  )
  const palN = num(pal) ?? 1
  const ftN = num(ft) ?? 1
  const feN = num(fe) ?? 1
  // VET único = GEB × (FA + FT + FE − 2). Con FT=FE=1 es GEB × PAL.
  const vet = geb !== null && conFactores ? vetConFactores(geb, palN, ftN, feN) : null

  /* ---- Gasto por ejercicio (R42) ----
   *
   * El GEE se calcula en cada render a partir de las filas: guardarlo en
   * estado obligaría a recalcularlo en cuatro sitios y a que ninguno se
   * olvide.
   */
  const geeEntradas: EntradaGEE[] = geeFilas.map((f) => {
    const kg = num(f.kg) ?? 0
    const minutos = num(f.minutos) ?? 0
    const mets = num(f.mets) ?? 0
    return {
      id: f.id,
      actividad: f.actividad,
      mets,
      kg,
      minutos,
      gee: calcularGEE(kg, minutos, mets),
    }
  })
  const geeTotal = round1(geeEntradas.reduce((t, e) => t + e.gee, 0))

  const getCunn = esCunningham && geb !== null ? getCunningham(geb, geeTotal) : null
  const de =
    getCunn !== null && mlgN !== null ? disponibilidadEnergetica(getCunn, geeTotal, mlgN) : null
  const lecturaDE = de !== null ? interpretarDE(de) : null

  /** El total que pasa a la Sección B, venga del camino que venga. */
  const totalEnergetico = esCunningham ? getCunn : vet

  // Prefills: peso a utilizar ← peso actual; PI a utilizar ← PI ADA
  // sugerido; REQ (Sección B) ← total energético. Solo mientras el campo
  // siga vacío.
  useEffect(() => {
    if (pesoActualN !== null) setPesoUtilizar((p) => (p === '' ? String(pesoActualN) : p))
  }, [pesoActualN])
  useEffect(() => {
    if (piAdaSugerido !== null) setPiUtilizar((p) => (p === '' ? String(piAdaSugerido) : p))
  }, [piAdaSugerido])
  /**
   * REQ sigue al total mientras nadie lo haya tocado.
   *
   * Antes solo se rellenaba estando vacío, y cambiar de método dejaba el
   * REQ con el total del método anterior: la Sección A enseñaba un GET de
   * Cunningham y la B repartía el VET de Mifflin. Se compara con lo
   * último que puso este efecto, así que un número escrito a mano no se
   * pisa nunca.
   */
  const reqAutorellenado = useRef<string | null>(null)
  useEffect(() => {
    if (totalEnergetico === null) return
    const nuevo = String(totalEnergetico)
    setReqDieta((r) => {
      if (r !== '' && r !== reqAutorellenado.current) return r
      reqAutorellenado.current = nuevo
      return nuevo
    })
  }, [totalEnergetico])

  /* ---- Edición de la tabla GEE ---- */

  function agregarActividad() {
    setGeeFilas((prev) => [
      ...prev,
      {
        id: idGee(),
        actividad: CATALOGO_ACTIVIDADES[0].etiqueta,
        mets: String(CATALOGO_ACTIVIDADES[0].mets),
        // El peso se precarga pero queda editable: una sesión de pesas
        // con chaleco lastrado no se calcula con el peso del paciente.
        kg: pesoActualN !== null ? String(pesoActualN) : '',
        minutos: '',
      },
    ])
  }

  function editarActividad(id: string, campo: keyof Omit<FilaGEE, 'id'>, valor: string) {
    setGeeFilas((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f
        if (campo !== 'actividad') return { ...f, [campo]: valor }
        // Elegir del catálogo precarga sus METS; «Actividad libre» los
        // deja en blanco para escribirlos. En ambos casos siguen siendo
        // editables después.
        const delCatalogo = CATALOGO_ACTIVIDADES.find((a) => a.etiqueta === valor)
        return { ...f, actividad: valor, mets: delCatalogo ? String(delCatalogo.mets) : '' }
      }),
    )
  }

  function quitarActividad(id: string) {
    setGeeFilas((prev) => prev.filter((f) => f.id !== id))
  }

  /* ---- Derivados de la Sección B ---- */
  const reqN = num(reqDieta)
  const sumaPct = (num(choPct) ?? 0) + (num(protPct) ?? 0) + (num(grasaPct) ?? 0)
  const macros =
    reqN !== null
      ? macrosMeta(reqN, num(choPct) ?? 0, num(protPct) ?? 0, num(grasaPct) ?? 0, pesoUtilN)
      : null

  const metodo = METODOS_DIETA[metodoDieta]
  const distribucion =
    macros && reqN !== null
      ? calcularDistribucion(metodo, { cho: macros.choG, prot: macros.protG, grasa: macros.grasaG, kcal: reqN }, porciones)
      : null

  // Totales de las columnas extra (Sat/Mono/Poli/Colest) de la Colombiana.
  const extraTotal =
    metodo.columnasExtra && distribucion
      ? metodo.grupos.reduce(
          (t, g) => {
            const n = porciones[g.clave] ?? 0
            return {
              sat: t.sat + n * (g.sat ?? 0),
              mono: t.mono + n * (g.mono ?? 0),
              poli: t.poli + n * (g.poli ?? 0),
              colest: t.colest + n * (g.colest ?? 0),
            }
          },
          { sat: 0, mono: 0, poli: 0, colest: 0 },
        )
      : null

  /* Azúcar y sal recomendadas (R44). El azúcar sale del REQ de la
     distribución activa; la sal, de la meta de sodio elegida. */
  const azucarCdas = reqN !== null ? azucarLibreCdas(reqN) : null
  const salDeSodio = sodioMg !== null ? salCdtas(sodioMg) : null

  const sal =
    num(naRecomendado) !== null && num(naAportado) !== null
      ? calcularSal(num(naRecomendado) as number, num(naAportado) as number)
      : null

  function setPorcion(clave: string, valor: string) {
    const v = num(valor)
    setPorciones((prev) => ({ ...prev, [clave]: v ?? 0 }))
  }

  if (!abierto) return null

  const puedeAplicar = reqN !== null && reqN > 0 && Math.round(sumaPct) === 100

  function aplicar() {
    if (!macros || reqN === null || !distribucion) return
    // Solo las líneas con porciones > 0, en el orden de la tabla, con el
    // nombre visible del grupo.
    const listasIntercambio: LineaIntercambio[] = distribucion.filas
      .filter((f) => f.porciones > 0)
      .map((f) => ({ grupo: f.etiqueta, porciones: f.porciones }))
    onEnviar({
      metaCalorica: Math.round(reqN),
      metodoDieta,
      distribucionMacros: {
        choPct: macros.choPct,
        protPct: macros.protPct,
        grasaPct: macros.grasaPct,
        choG: macros.choG,
        protG: macros.protG,
        grasaG: macros.grasaG,
        choGkg: macros.choGKg ?? 0,
        protGkg: macros.protGKg ?? 0,
        grasaGkg: macros.grasaGKg ?? 0,
      },
      listasIntercambio,
      // R42. Los cuatro últimos solo tienen valor con Cunningham; con
      // los demás métodos van a null para que no quede un GET colgado de
      // un cálculo que ya no rige.
      metodoGer: metodoGeb,
      mlgKg: mlgN,
      geeEntradas: esCunningham ? geeEntradas : [],
      geeTotal: esCunningham ? geeTotal : null,
      getCunningham: getCunn,
      disponibilidadEnergetica: de,
      sodioMg,
    })
  }

  // Mapa de sugerencias de corte por macro, para intercalar filas.
  const corteDe = new Map((distribucion?.cortes ?? []).map((c) => [c.cierre, c]))
  const filaDe = new Map((distribucion?.filas ?? []).map((f) => [f.clave, f]))

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onCerrar} aria-hidden="true" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Calculadora nutricional"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-border bg-surface shadow-lg"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold text-ink">Calculadora de requerimiento y dieta</h2>
            {cargandoDatos && <span className="text-xs text-muted">Cargando datos…</span>}
            {!cargandoDatos && hidratado && (
              <span className="rounded-pill bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary">
                Datos cargados del expediente
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar calculadora"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {/* ============ SECCIÓN A ============ */}
          <section className="space-y-3">
            <Titulo>A · Evaluación antropométrica y requerimiento</Titulo>

            {/* Género */}
            <div>
              <span className="mb-1 block text-xs font-medium text-ink">Género</span>
              <div className="flex gap-2">
                {(['masculino', 'femenino'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGenero(g)}
                    className={`rounded-pill border px-3 py-1 text-xs ${
                      genero === g
                        ? 'border-primary bg-primary-tint font-medium text-primary'
                        : 'border-border text-ink hover:bg-surface-2'
                    }`}
                  >
                    {g === 'masculino' ? 'Masculino' : 'Femenino'}
                  </button>
                ))}
              </div>
              {genero === null && (
                <p className="mt-1 text-xs" style={{ color: 'var(--status-alert)' }}>
                  Sin género no se estiman GEB ni pesos ideales.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <CampoNum id="edad" etiqueta="Edad" ayuda="años" valor={edadStr} onChange={setEdadStr} />
              <CampoNum id="pact" etiqueta="Peso actual" ayuda="kg" valor={pesoActual} onChange={(v) => { setPesoActual(v); setHidratado(false) }} />
              <CampoNum id="pus" etiqueta="Peso usual" ayuda="opcional" valor={pesoUsual} onChange={setPesoUsual} />
              <CampoNum id="talla" etiqueta="Talla" ayuda="cm" valor={tallaStr} onChange={(v) => { setTallaStr(v); setHidratado(false) }} />
              <CampoNum id="rod" etiqueta="Altura de rodilla" ayuda="opcional" valor={rodilla} onChange={setRodilla} />
              <CampoNum id="mun" etiqueta="Circ. muñeca" ayuda="cm" paso="0.1" valor={muneca} onChange={setMuneca} />
              <CampoNum id="bra" etiqueta="Circ. braquial" ayuda="opcional" valor={braquial} onChange={(v) => { setBraquial(v); setHidratado(false) }} />
              <CampoNum id="abd" etiqueta="Circ. abdominal" ayuda="opcional" valor={abdominal} onChange={(v) => { setAbdominal(v); setHidratado(false) }} />
              <CampoNum id="cad" etiqueta="Circ. cadera" ayuda="opcional" valor={cadera} onChange={(v) => { setCadera(v); setHidratado(false) }} />
              <CampoNum id="grasa" etiqueta="% de grasa" ayuda="opcional" valor={pctGrasa} onChange={(v) => { setPctGrasa(v); setHidratado(false) }} />
              <CampoNum
                id="mlg"
                etiqueta="Masa libre de grasa"
                ayuda={mlgDerivada !== null ? `kg · ${mlgDerivada} estimada` : 'kg'}
                valor={mlg}
                onChange={(v) => { setMlg(v); setHidratado(false) }}
              />
            </div>

            {/* Lecturas antropométricas */}
            <div className="space-y-1">
              {tallaEstimada !== null && (
                <Lectura etiqueta="Talla estimada (rodilla)" valor={`${tallaEstimada} cm`} />
              )}
              <div className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2 py-1">
                <span className="flex items-center gap-1 text-xs text-muted">
                  <span aria-hidden="true">🔒</span> Estructura corporal
                </span>
                <span className="flex items-center gap-2">
                  {indice !== null && <span className="text-sm tabular-nums text-ink">{indice}</span>}
                  {estructura !== null ? <BadgeEstructura estructura={estructura} /> : <span className="text-xs text-muted">—</span>}
                </span>
              </div>
              <Lectura
                etiqueta="IMC"
                valor={imcVal !== null ? `${imcVal} · ${clasificarImc(imcVal)}` : '—'}
              />
            </div>

            {/* Pesos ideales (referencia) */}
            <div className="rounded-md border border-border p-2">
              <p className="mb-1 text-xs font-semibold text-ink">Peso ideal (referencia)</p>
              <div className="space-y-1">
                {piAda && (
                  <div className="grid grid-cols-3 gap-1 text-center text-xs">
                    {(['pequena', 'mediana', 'grande'] as const).map((e) => (
                      <div
                        key={e}
                        className={`rounded-md p-1 ${estructura === e ? 'bg-primary-tint text-primary' : 'bg-surface-2 text-ink'}`}
                      >
                        <div className="text-muted">ADA {ETIQUETA_ESTRUCTURA[e]}</div>
                        <div className="font-semibold tabular-nums">{piAda[e]} kg</div>
                      </div>
                    ))}
                  </div>
                )}
                {piFec && (
                  <Lectura etiqueta="FEC/IMC (peq · med · gr)" valor={`${piFec.pequena} · ${piFec.mediana} · ${piFec.grande}`} />
                )}
                {piAm !== null && <Lectura etiqueta="IMC adulto mayor" valor={`${piAm} kg`} />}
                {piLor !== null && <Lectura etiqueta="Lorentz" valor={`${piLor} kg`} />}
                {piEnc !== null && <Lectura etiqueta="Encamado (rodilla+braquial)" valor={`${piEnc} kg`} />}
              </div>
            </div>

            {/* Método GEB y factores */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="col-span-2">
                <label htmlFor="mgeb" className="mb-0.5 block text-xs font-medium text-ink">
                  Método GEB
                </label>
                <select
                  id="mgeb"
                  value={metodoGeb}
                  onChange={(e) => setMetodoGeb(e.target.value as MetodoGeb)}
                  className={CTRL_EDITABLE}
                >
                  {metodosGeb.map((m) => (
                    <option key={m.clave} value={m.clave}>
                      {m.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
              {/* Cunningham no multiplica por factores: suma el gasto del
                  ejercicio en la tabla GEE. Dejarlos a la vista invitaría
                  a contar dos veces la misma actividad (R42). */}
              {conFactores && (
                <>
                  <CampoNum id="pal" etiqueta="PA L / FA" valor={pal} onChange={setPal} />
                  <CampoNum id="ft" etiqueta="FT" ayuda="térmico" valor={ft} onChange={setFt} />
                  <CampoNum id="fe" etiqueta="FE" ayuda="estrés" valor={fe} onChange={setFe} />
                </>
              )}
              <CampoNum id="putil" etiqueta="Peso a utilizar" ayuda="kg" valor={pesoUtilizar} onChange={setPesoUtilizar} />
              <CampoNum id="piutil" etiqueta="PI a utilizar" ayuda="kg" valor={piUtilizar} onChange={setPiUtilizar} />
              <CampoNum id="imcd" etiqueta="IMC deseado" valor={imcDeseado} onChange={setImcDeseado} />
            </div>

            <div className="space-y-1">
              {pAjustado !== null && <Lectura etiqueta="Peso ajustado" valor={`${pAjustado} kg`} />}
              {pMetaImc !== null && <Lectura etiqueta="Peso meta (IMC deseado)" valor={`${pMetaImc} kg`} />}
            </div>

            {/* A8 — Resumen de requerimiento: GEB/GER y el total. */}
            <div className="rounded-md border border-border bg-surface-2 p-2">
              <p className="mb-1 text-xs font-semibold text-ink">
                Requerimiento — {METODOS_GEB.find((m) => m.clave === metodoGeb)?.etiqueta}
              </p>
              {geb === null ? (
                <p className="text-xs" style={{ color: 'var(--status-alert)' }}>
                  {esCunningham
                    ? 'Se requiere la masa libre de grasa (MLG). Ingresa el peso y % de grasa corporal.'
                    : `Faltan datos: ${
                        metodoGeb === 'fao_oms'
                          ? 'peso a utilizar, edad y género'
                          : 'peso a utilizar, talla, edad y género'
                      }.`}
                </p>
              ) : (
                <div className="space-y-1">
                  <Lectura
                    etiqueta={esCunningham ? 'GER' : metodoGeb === 'mifflin' ? 'TMB' : 'GEB'}
                    valor={`${geb} kcal`}
                  />
                  {esCunningham ? (
                    <>
                      <Lectura etiqueta="Efecto térmico de los alimentos (×1.1)" valor={`${round1(geb * 0.1)} kcal`} />
                      <Lectura etiqueta="GEE total (ejercicio)" valor={`${geeTotal} kcal`} />
                      <Lectura
                        etiqueta="GET (GER × 1.1 + GEE)"
                        valor={getCunn !== null ? `${getCunn} kcal` : '—'}
                        resaltar
                      />
                      <p className="text-xs text-muted">El GET pasa como «REQ a utilizar» a la Sección B.</p>
                    </>
                  ) : (
                    <>
                      <Lectura etiqueta="VET (GEB × (FA+FT+FE−2))" valor={vet !== null ? `${vet} kcal` : '—'} resaltar />
                      <p className="text-xs text-muted">El VET pasa como «REQ a utilizar» a la Sección B.</p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ---- Gasto energético por ejercicio, solo con Cunningham ---- */}
            {esCunningham && (
              <div className="space-y-2 rounded-md border border-border p-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-ink">Gasto Energético por Ejercicio (GEE)</p>
                  <p className="text-xs text-muted">0.0175 × kg × minutos × METS</p>
                </div>

                {geeFilas.length === 0 ? (
                  <p className="rounded-md bg-surface-2 px-2 py-3 text-center text-xs text-muted">
                    Sin actividades. El GET se calcula igual, solo con el efecto térmico.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {geeFilas.map((f, i) => {
                      const calculada = geeEntradas[i]
                      return (
                        <li key={f.id} className="space-y-1 rounded-md bg-surface-2 p-2">
                          <div className="flex items-end gap-2">
                            <div className="min-w-0 flex-1">
                              <label htmlFor={`act-${f.id}`} className="mb-0.5 block text-xs font-medium text-ink">
                                Actividad
                              </label>
                              <select
                                id={`act-${f.id}`}
                                value={f.actividad}
                                onChange={(e) => editarActividad(f.id, 'actividad', e.target.value)}
                                className={CTRL_EDITABLE}
                              >
                                {CATALOGO_ACTIVIDADES.map((a) => (
                                  <option key={a.etiqueta} value={a.etiqueta}>
                                    {a.etiqueta} · {a.mets} MET
                                  </option>
                                ))}
                                <option value={ACTIVIDAD_LIBRE}>{ACTIVIDAD_LIBRE}</option>
                              </select>
                            </div>
                            <button
                              type="button"
                              onClick={() => quitarActividad(f.id)}
                              aria-label={`Quitar ${f.actividad}`}
                              className="rounded-md border border-border px-2 py-1.5 text-xs text-muted hover:bg-surface hover:text-ink"
                            >
                              ✕
                            </button>
                          </div>

                          <div className="grid grid-cols-4 gap-2">
                            <CampoNum
                              id={`mets-${f.id}`}
                              etiqueta="METS"
                              paso="0.1"
                              valor={f.mets}
                              onChange={(v) => editarActividad(f.id, 'mets', v)}
                            />
                            <CampoNum
                              id={`kg-${f.id}`}
                              etiqueta="Peso"
                              ayuda="kg"
                              paso="0.1"
                              valor={f.kg}
                              onChange={(v) => editarActividad(f.id, 'kg', v)}
                            />
                            <CampoNum
                              id={`min-${f.id}`}
                              etiqueta="Minutos"
                              valor={f.minutos}
                              onChange={(v) => editarActividad(f.id, 'minutos', v)}
                            />
                            <div>
                              <span className="mb-0.5 block text-xs font-medium text-ink">GEE</span>
                              <Lectura etiqueta="kcal" valor={calculada ? calculada.gee : 0} />
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={agregarActividad}
                    className="rounded-md border border-primary px-3 py-1 text-xs font-medium text-primary hover:bg-primary-tint"
                  >
                    + Agregar actividad
                  </button>
                  <span className="text-xs text-muted">
                    GEE Total:{' '}
                    <strong className="tabular-nums text-ink">{geeTotal} kcal</strong>
                  </span>
                </div>
              </div>
            )}

            {/* ---- Disponibilidad energética ---- */}
            {esCunningham && getCunn !== null && (
              <div
                className="rounded-md border p-3"
                style={{
                  borderColor: lecturaDE?.color ?? 'var(--border)',
                  backgroundColor: lecturaDE
                    ? `color-mix(in srgb, ${lecturaDE.color} 8%, transparent)`
                    : undefined,
                }}
              >
                <p className="text-xs font-semibold text-ink">Disponibilidad Energética</p>
                {de === null || lecturaDE === null ? (
                  <p className="mt-1 text-xs" style={{ color: 'var(--status-alert)' }}>
                    Se requiere la masa libre de grasa (MLG) para calcularla.
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
                      {de}{' '}
                      <span className="text-xs font-medium text-muted">kcal / kg MLG / día</span>
                    </p>
                    {/* El nivel va escrito, no solo en color: el color por sí
                        solo no lo lee quien no distingue tonos. */}
                    <span
                      className="mt-1 inline-block rounded-pill px-2 py-0.5 text-xs font-semibold"
                      style={{
                        color: lecturaDE.color,
                        backgroundColor: `color-mix(in srgb, ${lecturaDE.color} 16%, transparent)`,
                      }}
                    >
                      {lecturaDE.etiqueta}
                    </span>
                    <p className="mt-1 text-xs text-muted">{lecturaDE.descripcion}</p>
                    {geeTotal === 0 && (
                      <p className="mt-1 text-xs text-muted">
                        GEE = 0. Agrega actividades para un cálculo más preciso.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </section>

          {/* ============ SECCIÓN B ============ */}
          <section className="space-y-3">
            <Titulo>B · Distribución de dieta</Titulo>

            {/* Tabs de método */}
            {/* Solo los métodos ofrecidos (R44), más el ya elegido si
                esta conclusión viene con uno retirado. */}
            <div className="flex gap-1 rounded-md bg-surface-2 p-1" role="tablist">
              {metodosOfrecidos(metodoDieta).map((clave) => (
                <button
                  key={clave}
                  type="button"
                  role="tab"
                  aria-selected={metodoDieta === clave}
                  onClick={() => setMetodoDieta(clave)}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                    metodoDieta === clave ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                >
                  {METODOS_DIETA[clave].etiqueta}
                </button>
              ))}
            </div>

            {/* REQ a utilizar (hereda el VET) */}
            <CampoNum
              id="req"
              etiqueta="REQ a utilizar"
              ayuda={esCunningham ? 'kcal · GET de la Sección A' : 'kcal · VET de la Sección A'}
              valor={reqDieta}
              onChange={setReqDieta}
            />

            {/* B1 — Distribución de macros con g/kg */}
            <div className="rounded-md border border-border p-2">
              <p className="mb-1 text-xs font-semibold text-ink">Distribución de macronutrientes</p>
              <div className="grid grid-cols-3 gap-2">
                <CampoNum id="cho" etiqueta="% CHO" valor={choPct} onChange={setChoPct} />
                <CampoNum id="prot" etiqueta="% Prot" valor={protPct} onChange={setProtPct} />
                <CampoNum id="grasa" etiqueta="% Grasa" valor={grasaPct} onChange={setGrasaPct} />
              </div>
              <p
                className={`mt-1 text-xs ${Math.round(sumaPct) === 100 ? 'text-muted' : ''}`}
                style={Math.round(sumaPct) !== 100 ? { color: 'var(--status-critical)' } : undefined}
              >
                Total {Math.round(sumaPct)} % {Math.round(sumaPct) !== 100 && '— debe sumar 100'}
              </p>
              {macros && (
                <div className="mt-1 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="py-1 pr-2 font-medium">Nutriente</th>
                        <th className="py-1 pr-2 text-right font-medium">%</th>
                        <th className="py-1 pr-2 text-right font-medium">kcal</th>
                        <th className="py-1 pr-2 text-right font-medium">g</th>
                        <th className="py-1 text-right font-medium">g/kg</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums text-ink">
                      {[
                        { n: 'CHO', p: macros.choPct, k: macros.choKcal, g: macros.choG, gk: macros.choGKg },
                        { n: 'Proteínas', p: macros.protPct, k: macros.protKcal, g: macros.protG, gk: macros.protGKg },
                        { n: 'Grasas', p: macros.grasaPct, k: macros.grasaKcal, g: macros.grasaG, gk: macros.grasaGKg },
                      ].map((m) => (
                        <tr key={m.n} className="border-t border-border">
                          <td className="py-1 pr-2">{m.n}</td>
                          <td className="py-1 pr-2 text-right">{m.p}</td>
                          <td className="py-1 pr-2 text-right">{m.k}</td>
                          <td className="py-1 pr-2 text-right">{m.g}</td>
                          <td className="py-1 text-right">{m.gk ?? '—'}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-border font-semibold">
                        <td className="py-1 pr-2">Total</td>
                        <td className="py-1 pr-2 text-right">{Math.round(sumaPct)}</td>
                        <td className="py-1 pr-2 text-right">{macros.choKcal + macros.protKcal + macros.grasaKcal}</td>
                        <td className="py-1 pr-2" />
                        <td className="py-1" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Aviso cuando la prescripción abierta usa un método ya
                retirado del selector: su pestaña aparece pero no se
                debería elegir para una nueva. */}
            {!METODOS_DIETA_OFRECIDOS.includes(metodoDieta) && (
              <p className="text-xs" style={{ color: 'var(--status-alert)' }}>
                {METODOS_DIETA[metodoDieta].etiqueta} ya no se ofrece para prescripciones nuevas.
                Se muestra porque esta conclusión la tiene guardada.
              </p>
            )}

            {/* ---- Azúcar y sal recomendadas (R44) ---- */}
            <div className="rounded-md border border-border p-2">
              <p className="mb-2 text-xs font-semibold text-ink">Azúcar y sal recomendadas</p>

              {/* Azúcar libre: no se elige nada, sale del REQ */}
              <div className="mb-2">
                <p className="mb-1 text-xs text-muted">
                  Azúcar libre — 10 % del REQ, en cucharadas de 15 g
                </p>
                {azucarCdas !== null ? (
                  <Lectura etiqueta="Azúcar libre" valor={`${azucarCdas} cdas/día`} />
                ) : (
                  <p className="text-xs text-muted">Indica el REQ a utilizar para calcularla.</p>
                )}
              </div>

              {/* Sal: cuatro metas de sodio */}
              <p className="mb-1 text-xs text-muted">Sal — según la meta de sodio</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Meta de sodio">
                {SODIO_OFRECIDO.map((mg) => (
                  <button
                    key={mg}
                    type="button"
                    role="radio"
                    aria-checked={sodioMg === mg}
                    // Volver a pulsar el elegido lo deselecciona: «no se
                    // fijó meta de sodio» tiene que poder recuperarse sin
                    // cerrar la calculadora.
                    onClick={() => setSodioMg(sodioMg === mg ? null : mg)}
                    className={`rounded-pill border px-3 py-1 text-xs tabular-nums ${
                      sodioMg === mg
                        ? 'border-primary bg-primary-tint font-semibold text-primary'
                        : 'border-border text-ink hover:bg-surface-2'
                    }`}
                  >
                    {mg} mg
                  </button>
                ))}
              </div>
              {salDeSodio !== null ? (
                <div className="mt-2">
                  <Lectura etiqueta="Sal" valor={`${salDeSodio} cdtas/día`} />
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted">
                  Elige una meta de sodio para calcular las cucharaditas.
                </p>
              )}
            </div>

            {/* B2/B3/B4 — Tabla de intercambios */}
            {distribucion ? (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-left">
                      <th className="px-2 py-1 font-semibold text-ink">Alimento</th>
                      <th className="px-2 py-1 font-semibold text-ink">Porciones</th>
                      {metodo.completo && <th className="px-2 py-1 text-right font-semibold text-ink">CHO</th>}
                      {metodo.completo && <th className="px-2 py-1 text-right font-semibold text-ink">Prot</th>}
                      {metodo.completo && <th className="px-2 py-1 text-right font-semibold text-ink">Grasa</th>}
                      <th className="px-2 py-1 text-right font-semibold text-ink">kcal</th>
                      {metodo.columnasExtra && <th className="px-2 py-1 text-right font-semibold text-ink">Sat</th>}
                      {metodo.columnasExtra && <th className="px-2 py-1 text-right font-semibold text-ink">Mono</th>}
                      {metodo.columnasExtra && <th className="px-2 py-1 text-right font-semibold text-ink">Poli</th>}
                      {metodo.columnasExtra && <th className="px-2 py-1 text-right font-semibold text-ink">Colest</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const rendered = new Set<string>()
                      const cols = 3 + (metodo.completo ? 3 : 0) + (metodo.columnasExtra ? 4 : 0)
                      const filas: ReactNode[] = []
                      for (const g of metodo.grupos) {
                        // Antes del primer grupo de un cierre, la fila de corte
                        // (sugerencia informativa, solo lectura, resaltada).
                        if (g.cierre && !rendered.has(g.cierre) && metodo.completo) {
                          rendered.add(g.cierre)
                          const c = corteDe.get(g.cierre)
                          filas.push(
                            <tr key={`corte-${g.cierre}`} className="border-b border-border">
                              <td className="px-2 py-1 font-medium" style={{ color: 'var(--status-alert)' }}>
                                {c?.etiqueta ?? 'Corte'}
                              </td>
                              <td className="px-2 py-1 font-semibold tabular-nums" style={{ color: 'var(--status-alert)' }}>
                                <span aria-hidden="true">🔒</span> {c?.valor ?? '—'}
                              </td>
                              <td colSpan={cols - 2} />
                            </tr>,
                          )
                        }
                        const f = filaDe.get(g.clave)
                        filas.push(
                          <tr key={g.clave} className="border-b border-border">
                            <td className={`px-2 py-1 text-ink ${g.cierre ? 'pl-4' : ''}`}>{g.etiqueta}</td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                min={0}
                                step="0.5"
                                value={porciones[g.clave] ?? ''}
                                onChange={(e) => setPorcion(g.clave, e.target.value)}
                                aria-label={`Porciones de ${g.etiqueta}`}
                                className="w-16 rounded border border-border bg-surface p-1 text-xs tabular-nums text-ink outline-none focus:border-primary"
                              />
                            </td>
                            {metodo.completo && <td className="px-2 py-1 text-right tabular-nums text-muted">{f?.cho ?? 0}</td>}
                            {metodo.completo && <td className="px-2 py-1 text-right tabular-nums text-muted">{f?.prot ?? 0}</td>}
                            {metodo.completo && <td className="px-2 py-1 text-right tabular-nums text-muted">{f?.grasa ?? 0}</td>}
                            <td className="px-2 py-1 text-right tabular-nums text-ink">{f?.kcal ?? 0}</td>
                            {metodo.columnasExtra && <td className="px-2 py-1 text-right tabular-nums text-muted">{round1((f?.porciones ?? 0) * (g.sat ?? 0))}</td>}
                            {metodo.columnasExtra && <td className="px-2 py-1 text-right tabular-nums text-muted">{round1((f?.porciones ?? 0) * (g.mono ?? 0))}</td>}
                            {metodo.columnasExtra && <td className="px-2 py-1 text-right tabular-nums text-muted">{round1((f?.porciones ?? 0) * (g.poli ?? 0))}</td>}
                            {metodo.columnasExtra && <td className="px-2 py-1 text-right tabular-nums text-muted">{Math.round((f?.porciones ?? 0) * (g.colest ?? 0))}</td>}
                          </tr>,
                        )
                      }
                      return filas
                    })()}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-surface-2 font-semibold">
                      <td className="px-2 py-1 text-ink">Total</td>
                      <td className="px-2 py-1" />
                      {metodo.completo && <td className="px-2 py-1 text-right tabular-nums text-ink">{distribucion.total.cho}</td>}
                      {metodo.completo && <td className="px-2 py-1 text-right tabular-nums text-ink">{distribucion.total.prot}</td>}
                      {metodo.completo && <td className="px-2 py-1 text-right tabular-nums text-ink">{distribucion.total.grasa}</td>}
                      <td className="px-2 py-1 text-right tabular-nums text-ink">{distribucion.total.kcal}</td>
                      {extraTotal && <td className="px-2 py-1 text-right tabular-nums text-ink">{round1(extraTotal.sat)}</td>}
                      {extraTotal && <td className="px-2 py-1 text-right tabular-nums text-ink">{round1(extraTotal.mono)}</td>}
                      {extraTotal && <td className="px-2 py-1 text-right tabular-nums text-ink">{round1(extraTotal.poli)}</td>}
                      {extraTotal && <td className="px-2 py-1 text-right tabular-nums text-ink">{Math.round(extraTotal.colest)}</td>}
                    </tr>
                    <tr className="text-muted">
                      <td className="px-2 py-1">% adecuación</td>
                      <td className="px-2 py-1" />
                      {metodo.completo && <td className="px-2 py-1 text-right tabular-nums">{distribucion.adecuacion.cho}%</td>}
                      {metodo.completo && <td className="px-2 py-1 text-right tabular-nums">{distribucion.adecuacion.prot}%</td>}
                      {metodo.completo && <td className="px-2 py-1 text-right tabular-nums">{distribucion.adecuacion.grasa}%</td>}
                      <td className="px-2 py-1 text-right tabular-nums">{distribucion.adecuacion.kcal}%</td>
                      {metodo.columnasExtra && <td colSpan={4} />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted">Indica el REQ y una distribución que sume 100 %.</p>
            )}

            {/* Cálculo de sal — INCIENSA */}
            {metodoDieta === 'INCIENSA' && (
              <div className="rounded-md border border-border p-2">
                <p className="mb-1 text-xs font-semibold text-ink">Cálculo de sal</p>
                <div className="grid grid-cols-2 gap-2">
                  <CampoNum id="narec" etiqueta="Na recomendado" ayuda="mg" valor={naRecomendado} onChange={setNaRecomendado} />
                  <CampoNum id="naap" etiqueta="Na aportado por dieta" ayuda="mg" valor={naAportado} onChange={setNaAportado} />
                </div>
                {sal && (
                  <div className="mt-1 space-y-1">
                    <Lectura etiqueta="Na libre" valor={`${sal.naLibre} mg`} />
                    <Lectura etiqueta="NaCl" valor={`${sal.naCl} mg`} />
                    <Lectura etiqueta="Sal" valor={`${sal.cdtasSal} cdtas`} />
                  </div>
                )}
              </div>
            )}

            {/* Micronutrientes — Colombiana */}
            {metodoDieta === 'Colombiana' && (
              <div className="rounded-md border border-border p-2">
                <p className="mb-1 text-xs font-semibold text-ink">Micronutrientes recomendados</p>
                <div className="flex flex-wrap gap-1.5">
                  {MICRONUTRIENTES_COLOMBIANA.map((mn) => (
                    <span key={mn} className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs text-muted">
                      {mn}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          <p className="text-xs text-muted">
            Todas las ecuaciones son estimaciones poblacionales. El requerimiento real de un paciente
            concreto lo decide quien lo atiende.
          </p>
        </div>

        <footer className="border-t border-border p-4">
          <button
            type="button"
            disabled={!puedeAplicar}
            onClick={aplicar}
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            Aplicar a la prescripción
          </button>
        </footer>
      </aside>
    </>
  )
}
