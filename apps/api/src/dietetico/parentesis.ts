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
 * ## Sin parentesis no se analiza nada — R45
 *
 * R43 hacia lo contrario: un texto sin parentesis se analizaba entero, por no
 * dejar sin valores a los registros ya escritos. **Se revirtio a proposito.**
 *
 * Analizar el relato completo es justo lo que esta seccion vino a evitar: el
 * modelo recibe «entra a las 6 de la mañana» y devuelve raciones, y el
 * profesional no tiene como saber que la cifra salio de ahi. Un total que nadie
 * pidio es peor que un total ausente — el ausente se ve.
 *
 * Asi que sin parentesis no hay analisis: no se llama a la IA, los `ai_*` se
 * limpian y la pantalla lo dice. El profesional marca lo que quiere que se
 * busque y vuelve a pulsar.
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
 * El texto que se manda a identificar, o **null para no analizar** — R45.
 *
 * Solo Consumo Usual aplica la convencion de los parentesis: el Recordatorio
 * de 24 horas es una lista de lo que se comio ayer, se escribe ya como lista,
 * y ahi un parentesis es una aclaracion («2 tazas de cafe (sin azucar)») que
 * no debe convertirse en el unico alimento de la fila. Por eso el 24 h devuelve
 * siempre su texto entero y nunca null.
 *
 * En Consumo Usual, `null` significa «el profesional no marco nada»: quien
 * llama no debe llamar a la IA, y debe dejar la fila sin valores. No es un
 * fallo —no hay nada roto— es que no hay nada que buscar.
 */
export function textoAAnalizar(texto: string, tipo: string): string | null {
  if (tipo !== 'consumo_usual') return texto
  return alimentosEntreParentesis(texto)
}
