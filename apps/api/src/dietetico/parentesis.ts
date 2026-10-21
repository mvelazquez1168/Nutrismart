/**
 * Los alimentos que SI entran al analisis de intercambios — R43.
 *
 * ## El problema
 *
 * En Consumo Usual el profesional no escribe una lista de alimentos: escribe
 * lo que el paciente le cuenta. «Generalmente desayuna tarde porque entra a
 * las 6, casi siempre cafe con leche y pan». De esa frase, lo unico que tiene
 * equivalencia en la lista de intercambios es «cafe con leche» y «pan»; el
 * resto es contexto clinico que el profesional necesita conservar escrito y
 * que al modelo solo le estorba — de hecho le hace inventar alimentos («entra
 * a las 6» se ha visto convertido en una racion).
 *
 * ## La convencion
 *
 * El profesional marca entre parentesis lo que quiere que se busque en la
 * lista: «...casi siempre (1 taza de cafe con leche) y (2 rebanadas de pan)».
 * La tabla lo dice con un aviso arriba, asi que no es una regla oculta.
 *
 * ## Por que se recorta aqui y no en el prompt
 *
 * Pedirle al modelo «ignora lo que esta fuera de los parentesis» es pedirle
 * que cumpla una regla; recortar el texto antes de mandarlo es garantizar que
 * la cumple. Ademas el prompt de la fase 1 ya es largo y lleva el catalogo
 * entero: una instruccion mas es una instruccion mas que puede perderse.
 *
 * ## La compatibilidad
 *
 * Un texto SIN parentesis se analiza completo, como siempre. Si no, los
 * registros ya escritos —y los de quien no conozca la convencion— pasarian de
 * tener valores a no tener ninguno, en silencio y sin que nada lo explique.
 */

/**
 * El contenido de los parentesis, unido por comas; null si no hay ninguno.
 *
 * Se aceptan los parentesis a medio cerrar («(cafe con leche») porque es lo
 * que queda al escribir y guardar sin terminar: el ultimo grupo abierto se
 * toma hasta el final del texto. Lo contrario —descartarlo— perderia justo el
 * alimento que el profesional estaba marcando.
 */
export function alimentosEntreParentesis(texto: string): string | null {
  const grupos: string[] = []
  let dentro = false
  let actual = ''

  for (const c of texto) {
    if (c === '(') {
      // Un «(» dentro de otro no abre nada nuevo: no hay anidamiento que
      // signifique algo aqui, y tratarlo como apertura partiria el alimento.
      if (!dentro) {
        dentro = true
        actual = ''
      }
      continue
    }
    if (c === ')') {
      if (dentro) {
        const limpio = actual.trim()
        if (limpio !== '') grupos.push(limpio)
        dentro = false
        actual = ''
      }
      continue
    }
    if (dentro) actual += c
  }

  // Parentesis abierto y nunca cerrado: vale lo que haya hasta el final.
  if (dentro) {
    const limpio = actual.trim()
    if (limpio !== '') grupos.push(limpio)
  }

  return grupos.length === 0 ? null : grupos.join(', ')
}

/**
 * El texto que se manda a identificar, segun el tipo de registro.
 *
 * Solo Consumo Usual aplica la convencion de los parentesis: el Recordatorio
 * de 24 horas es una lista de lo que se comio ayer, se escribe ya como lista,
 * y ahi un parentesis es una aclaracion («2 tazas de cafe (sin azucar)») que
 * no debe convertirse en el unico alimento de la fila.
 */
export function textoAAnalizar(texto: string, tipo: string): string {
  if (tipo !== 'consumo_usual') return texto
  return alimentosEntreParentesis(texto) ?? texto
}
