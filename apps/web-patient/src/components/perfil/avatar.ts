/**
 * Catálogo y geometría del avatar ilustrado — R53.
 *
 * Aquí viven los datos: qué opciones hay, qué personajes trae la galería
 * y qué trazos dibuja cada estilo de pelo. El dibujo en sí lo hace
 * `Avatar.tsx`, en JSX.
 *
 * Están separados a propósito. El generador de referencia
 * (`docs/prompts/nutrismart-avatar-propuestas.html`) construía el SVG
 * concatenando cadenas, que en React obligaría a
 * `dangerouslySetInnerHTML` con colores que vienen del servidor. Dejando
 * aquí solo las rutas —constantes, elegidas por clave, nunca
 * interpoladas— y pintando en JSX, no hay ninguna cadena de marcado que
 * inyectar.
 *
 * El lienzo es 100×100 y la cara va centrada en (50, 59): son las
 * coordenadas de la referencia y no se tocan, porque cada pieza —ojos,
 * cejas, mejillas, orejas— está colocada a mano respecto a ellas.
 */

/* ------------------------------------------------------------------ */
/* Opciones                                                            */
/* ------------------------------------------------------------------ */

export const PIELES = [
  { hex: '#FDDCB5', etiqueta: 'Clara' },
  { hex: '#EDB98A', etiqueta: 'Beige' },
  { hex: '#D08B5B', etiqueta: 'Media' },
  { hex: '#A57248', etiqueta: 'Morena' },
  { hex: '#3D1F0A', etiqueta: 'Oscura' },
] as const

export const ESTILOS_CABELLO = [
  { clave: 'Corto', etiqueta: 'Corto' },
  { clave: 'Largo', etiqueta: 'Largo' },
  { clave: 'Rizado', etiqueta: 'Rizado' },
  { clave: 'Ondulado', etiqueta: 'Ondulado' },
  { clave: 'Moño', etiqueta: 'Moño' },
  { clave: 'Corto M', etiqueta: 'Masculino' },
  { clave: 'Calvo', etiqueta: 'Calvo' },
] as const

export type EstiloCabello = (typeof ESTILOS_CABELLO)[number]['clave']

export const COLORES_CABELLO = [
  '#0D0D0D',
  '#3B1F0A',
  '#6B3A2A',
  '#A0522D',
  '#D4A017',
  '#A9A9A9',
  '#8B0000',
] as const

export const EXPRESIONES = [
  { clave: 'Sonrisa', etiqueta: 'Sonrisa' },
  { clave: 'Neutral', etiqueta: 'Neutral' },
  { clave: 'Amplia', etiqueta: 'Amplia' },
] as const

export type Expresion = (typeof EXPRESIONES)[number]['clave']

/** Lo que define un avatar. Son las columnas `avatar_*` de la base. */
export interface ConfigAvatar {
  personaje: number
  piel: string
  cabelloEstilo: EstiloCabello
  cabelloColor: string
  ojos: string
  expresion: Expresion
  lentes: boolean
}

/* ------------------------------------------------------------------ */
/* Galería: 12 personajes                                              */
/* ------------------------------------------------------------------ */

/**
 * Los doce son la lista de la referencia, sin los colores de fondo.
 *
 * En la referencia cada personaje traía su propio degradado. Aquí el
 * fondo sale SIEMPRE de la paleta que eligió el paciente, como pide
 * R53: así la galería enseña exactamente lo que va a quedar guardado,
 * y cambiar de paleta recolorea también el avatar. Los doce se siguen
 * distinguiendo de un vistazo por piel, pelo, ojos y expresión, que es
 * lo que de verdad se está eligiendo.
 */
export const GALERIA: ConfigAvatar[] = [
  { personaje: 0,  piel: '#FDDCB5', cabelloEstilo: 'Largo',    cabelloColor: '#2C1B18', ojos: '#5C4033', expresion: 'Sonrisa', lentes: false },
  { personaje: 1,  piel: '#A57248', cabelloEstilo: 'Corto M',  cabelloColor: '#1A1A1A', ojos: '#1A1A1A', expresion: 'Amplia',  lentes: false },
  { personaje: 2,  piel: '#EDB98A', cabelloEstilo: 'Ondulado', cabelloColor: '#D4A017', ojos: '#5C7A2A', expresion: 'Amplia',  lentes: false },
  { personaje: 3,  piel: '#F5C5A3', cabelloEstilo: 'Rizado',   cabelloColor: '#A0522D', ojos: '#7C5C3A', expresion: 'Sonrisa', lentes: false },
  { personaje: 4,  piel: '#3D1F0A', cabelloEstilo: 'Moño',     cabelloColor: '#2C1B18', ojos: '#3D2B1A', expresion: 'Sonrisa', lentes: false },
  { personaje: 5,  piel: '#D08B5B', cabelloEstilo: 'Corto M',  cabelloColor: '#1A1A1A', ojos: '#1A1A1A', expresion: 'Neutral', lentes: true  },
  { personaje: 6,  piel: '#FDDCB5', cabelloEstilo: 'Largo',    cabelloColor: '#8B0000', ojos: '#1A4D7C', expresion: 'Amplia',  lentes: false },
  { personaje: 7,  piel: '#C68642', cabelloEstilo: 'Rizado',   cabelloColor: '#1A1A1A', ojos: '#1A1A1A', expresion: 'Sonrisa', lentes: false },
  { personaje: 8,  piel: '#FDDCB5', cabelloEstilo: 'Corto',    cabelloColor: '#A9A9A9', ojos: '#2C5F8A', expresion: 'Neutral', lentes: true  },
  { personaje: 9,  piel: '#F0C8A0', cabelloEstilo: 'Moño',     cabelloColor: '#C8A068', ojos: '#6B4F3A', expresion: 'Amplia',  lentes: false },
  { personaje: 10, piel: '#3D1F0A', cabelloEstilo: 'Corto M',  cabelloColor: '#1A1A1A', ojos: '#5C3A1A', expresion: 'Sonrisa', lentes: false },
  { personaje: 11, piel: '#EDB98A', cabelloEstilo: 'Calvo',    cabelloColor: '#1A1A1A', ojos: '#2C1B18', expresion: 'Amplia',  lentes: false },
]

export const AVATAR_POR_DEFECTO: ConfigAvatar = GALERIA[0]!

/* ------------------------------------------------------------------ */
/* Geometría del pelo                                                  */
/* ------------------------------------------------------------------ */

/**
 * El pelo va en dos capas: la de DETRÁS, que se dibuja antes que la
 * cara y asoma por los lados, y la CORONA, que se dibuja encima y tapa
 * el nacimiento. Sin esa separación, una melena larga o sale recortada
 * por la cara o le tapa los ojos.
 */
export type TrazoPelo =
  | { tipo: 'path'; d: string; grosor?: number }
  | { tipo: 'circulo'; cx: number; cy: number; r: number }

export const PELO_DETRAS: Partial<Record<EstiloCabello, TrazoPelo[]>> = {
  Largo: [
    { tipo: 'path', d: 'M25 50 Q21 68 23 86 Q22 96 26 104', grosor: 13 },
    { tipo: 'path', d: 'M75 50 Q79 68 77 86 Q78 96 74 104', grosor: 13 },
  ],
  Ondulado: [
    { tipo: 'path', d: 'M26 50 Q18 63 26 76 Q18 87 26 100', grosor: 13 },
    { tipo: 'path', d: 'M74 50 Q82 63 74 76 Q82 87 74 100', grosor: 13 },
  ],
  Rizado: [
    { tipo: 'circulo', cx: 26, cy: 48, r: 13 },
    { tipo: 'circulo', cx: 74, cy: 48, r: 13 },
  ],
}

/** La forma de siempre: la comparten Corto, Largo y Ondulado. */
const CORONA_BASE = 'M29 53 Q29 23 50 21 Q71 23 71 53 Q71 38 65 27 Q57 14 50 13 Q43 14 35 27 Q29 38 29 53Z'

export const PELO_CORONA: Record<EstiloCabello, TrazoPelo[]> = {
  Corto: [{ tipo: 'path', d: CORONA_BASE }],
  Largo: [{ tipo: 'path', d: CORONA_BASE }],
  Ondulado: [{ tipo: 'path', d: CORONA_BASE }],
  Rizado: [
    { tipo: 'circulo', cx: 50, cy: 26, r: 19 },
    { tipo: 'circulo', cx: 36, cy: 33, r: 12 },
    { tipo: 'circulo', cx: 64, cy: 33, r: 12 },
  ],
  'Moño': [
    { tipo: 'path', d: 'M31 54 Q31 27 50 25 Q69 27 69 54 Q69 40 64 30 Q56 18 50 17 Q44 18 36 30 Q31 40 31 54Z' },
    { tipo: 'circulo', cx: 50, cy: 17, r: 10 },
  ],
  'Corto M': [
    { tipo: 'path', d: 'M30 54 Q28 25 50 22 Q72 25 70 54 Q71 40 65 29 Q58 16 50 15 Q42 16 35 29 Q29 40 30 54Z' },
  ],
  Calvo: [],
}

/* ------------------------------------------------------------------ */
/* Bocas                                                               */
/* ------------------------------------------------------------------ */

export const BOCAS: Record<
  Expresion,
  { d?: string; linea?: boolean; trazo: string; grosor: number; relleno: string }
> = {
  Sonrisa: { d: 'M42 69 Q50 77 58 69', trazo: '#C45A6A', grosor: 2.2, relleno: 'none' },
  Neutral: { linea: true, trazo: '#A07080', grosor: 1.8, relleno: 'none' },
  Amplia: { d: 'M40 67 Q50 79 60 67', trazo: '#C45A6A', grosor: 2.5, relleno: '#FFAAAA' },
}

/* ------------------------------------------------------------------ */
/* Saneado                                                             */
/* ------------------------------------------------------------------ */

const RE_HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Un color que no sea hexadecimal de seis dígitos se cambia por el de
 * reserva.
 *
 * La base ya lo impone con un CHECK, así que esto es el segundo
 * cinturón: estos valores acaban en atributos de un SVG, y la regla es
 * no confiar en que lo que llega del servidor tenga la forma que
 * promete.
 */
export function colorSeguro(valor: string | null | undefined, reserva: string): string {
  return typeof valor === 'string' && RE_HEX.test(valor) ? valor : reserva
}

const ESTILOS = new Set<string>(ESTILOS_CABELLO.map((e) => e.clave))
const EXPRS = new Set<string>(EXPRESIONES.map((e) => e.clave))

/**
 * La forma en que llega del servidor: todo opcional y sin estrechar.
 *
 * `cabelloEstilo` y `expresion` son `string` y no sus uniones a
 * propósito. Son datos de red: tiparlos como la union seria AFIRMAR que
 * el servidor solo manda valores validos, y entonces `configSegura` no
 * tendria nada que comprobar.
 */
export interface ConfigAvatarBruta {
  personaje?: number
  piel?: string
  cabelloEstilo?: string
  cabelloColor?: string
  ojos?: string
  expresion?: string
  lentes?: boolean
}

/** Normaliza lo que venga del servidor a una configuración dibujable. */
export function configSegura(bruto: ConfigAvatarBruta | null | undefined): ConfigAvatar {
  const d = AVATAR_POR_DEFECTO
  const b = bruto ?? {}
  const personaje =
    typeof b.personaje === 'number' && b.personaje >= 0 && b.personaje <= 11
      ? Math.floor(b.personaje)
      : d.personaje
  return {
    personaje,
    piel: colorSeguro(b.piel, d.piel),
    cabelloEstilo: ESTILOS.has(b.cabelloEstilo as string)
      ? (b.cabelloEstilo as EstiloCabello)
      : d.cabelloEstilo,
    cabelloColor: colorSeguro(b.cabelloColor, d.cabelloColor),
    ojos: colorSeguro(b.ojos, d.ojos),
    expresion: EXPRS.has(b.expresion as string) ? (b.expresion as Expresion) : d.expresion,
    lentes: b.lentes === true,
  }
}
