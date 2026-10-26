import { useId } from 'react'
import {
  BOCAS,
  PELO_CORONA,
  PELO_DETRAS,
  type ConfigAvatar,
  type TrazoPelo,
} from './avatar'

/**
 * La cara ilustrada, en SVG — R53.
 *
 * Portada del prototipo `docs/prompts/nutrismart-avatar-propuestas.html`
 * conservando sus coordenadas: el lienzo es 100×100, la cabeza es una
 * elipse centrada en (50, 59) y todo lo demás —orejas, ojos, cejas,
 * nariz, boca, mejillas— está colocado a mano respecto a ella. Mover la
 * cabeza obliga a recolocarlo todo, así que no se mueve.
 *
 * El orden de pintado es el que hace que funcione:
 *
 *   fondo → pelo de detrás → cuello y hombros → cara → corona de pelo
 *   → orejas → ojos → cejas → nariz → boca → mejillas → gafas
 *
 * El pelo va partido en dos capas por eso mismo: la melena tiene que
 * quedar DETRÁS de la cara y el flequillo DELANTE.
 *
 * El fondo sale de la paleta activa del paciente (`--primary` →
 * `--primary-hover`), no del personaje. Así la galería enseña ya lo que
 * va a quedar guardado y cambiar de paleta recolorea el avatar.
 */
export function CaraSVG({
  config,
  className,
}: {
  config: ConfigAvatar
  className?: string
}) {
  // Los ids de <defs> son globales al documento: dos avatares en la
  // misma pantalla con el mismo id harían que el segundo usara el
  // degradado del primero. `useId` da uno distinto por instancia.
  const id = useId().replace(/:/g, '')
  const idFondo = `av-bg-${id}`
  const idRecorte = `av-cl-${id}`

  const { piel, cabelloColor, ojos, expresion, lentes, cabelloEstilo } = config
  const boca = BOCAS[expresion] ?? BOCAS.Sonrisa

  const pintarPelo = (trazos: TrazoPelo[] | undefined, clave: string) =>
    (trazos ?? []).map((t, i) =>
      t.tipo === 'circulo' ? (
        <circle key={`${clave}${i}`} cx={t.cx} cy={t.cy} r={t.r} fill={cabelloColor} />
      ) : (
        <path
          key={`${clave}${i}`}
          d={t.d}
          fill={t.grosor ? 'none' : cabelloColor}
          stroke={t.grosor ? cabelloColor : undefined}
          strokeWidth={t.grosor}
          strokeLinecap={t.grosor ? 'round' : undefined}
        />
      ),
    )

  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Tu avatar">
      <defs>
        <linearGradient id={idFondo} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--primary-hover)" />
        </linearGradient>
        <clipPath id={idRecorte}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
      </defs>

      <circle cx="50" cy="50" r="50" fill={`url(#${idFondo})`} />

      <g clipPath={`url(#${idRecorte})`}>
        {pintarPelo(PELO_DETRAS[cabelloEstilo], 'd')}

        {/* Hombros y cuello: la elipse de abajo asoma por el recorte y
            hace de busto, el rectángulo la une con la cabeza. */}
        <ellipse cx="50" cy="102" rx="32" ry="18" fill={piel} />
        <rect x="44" y="80" width="12" height="16" fill={piel} />

        <ellipse cx="50" cy="59" rx="22" ry="26" fill={piel} />

        {pintarPelo(PELO_CORONA[cabelloEstilo], 'c')}

        <ellipse cx="27.5" cy="60" rx="4" ry="5" fill={piel} />
        <ellipse cx="72.5" cy="60" rx="4" ry="5" fill={piel} />

        {/* Ojo: blanco, iris, pupila y un brillo descentrado. El brillo
            es lo que los hace parecer vivos en vez de dos botones. */}
        <ellipse cx="43" cy="56" rx="6" ry="5" fill="white" />
        <ellipse cx="57" cy="56" rx="6" ry="5" fill="white" />
        <circle cx="43" cy="56" r="3.5" fill={ojos} />
        <circle cx="57" cy="56" r="3.5" fill={ojos} />
        <circle cx="43.5" cy="56" r="1.8" fill="#0D0D0D" />
        <circle cx="57.5" cy="56" r="1.8" fill="#0D0D0D" />
        <circle cx="45" cy="54.2" r="1.2" fill="white" />
        <circle cx="59" cy="54.2" r="1.2" fill="white" />

        {/* Las cejas van del color del pelo aunque sea calvo: una cara
            sin cejas se lee como un error de dibujo. */}
        <path
          d="M37 49.5 Q43 47.5 49 49.5"
          stroke={cabelloColor}
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M51 49.5 Q57 47.5 63 49.5"
          stroke={cabelloColor}
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
        />

        <path d="M48 62 Q46 66.5 50 67.5 Q54 66.5 52 62" stroke="#B07C6A" strokeWidth={1.3} fill="none" />

        {boca.linea ? (
          <line
            x1="43"
            y1="68"
            x2="57"
            y2="68"
            stroke={boca.trazo}
            strokeWidth={boca.grosor}
            strokeLinecap="round"
          />
        ) : (
          <path
            d={boca.d}
            stroke={boca.trazo}
            strokeWidth={boca.grosor}
            fill={boca.relleno}
            strokeLinecap="round"
          />
        )}

        <circle cx="36.5" cy="65" r="5.5" fill="rgba(255,148,148,0.32)" />
        <circle cx="63.5" cy="65" r="5.5" fill="rgba(255,148,148,0.32)" />

        {lentes && (
          <path
            d="M34 54 h-7 m7,0 a9,6 0 0,1 18,0 m0,0 h4 m0,0 a9,6 0 0,1 18,0 m0,0 h7"
            stroke="rgba(60,60,80,0.75)"
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
          />
        )}
      </g>
    </svg>
  )
}
