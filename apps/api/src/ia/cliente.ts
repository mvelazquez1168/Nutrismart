/**
 * Cliente de Claude — IA-01, IA-02.
 *
 * Un solo punto de salida hacia la API: aqui se decide el modelo, se
 * acota el tiempo de espera, se traducen los fallos y se registra el
 * consumo. Que cada ruta construyera su propia llamada significaria que
 * el medidor dependeria de que nadie se olvide de anotarla.
 *
 * ── Sobre el modelo ──────────────────────────────────────────────────
 *
 * La especificacion pedia 'claude-3-5-haiku-20241022'. Ese identificador
 * esta RETIRADO desde el 19 de febrero de 2026 y devuelve 404: la
 * funcion habria fallado siempre, con un error que parece de red. Su
 * reemplazo directo es claude-haiku-4-5, que es lo que se usa. El
 * modelo alternativo que sugeria la especificacion para subir de calidad
 * —'claude-3-5-sonnet-20241022'— tambien esta retirado; hoy seria
 * claude-sonnet-5.
 *
 * Se respeta la eleccion de gama: Haiku es barato y suficiente para
 * redactar sobre datos que se le entregan ya calculados. Quien quiera
 * mas capacidad cambia ANTHROPIC_MODELO sin tocar codigo.
 */
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { pool } from '../db.js'

/** Fallo controlado: la ruta lo traduce a 503 sin filtrar detalles. */
export class IaNoDisponibleError extends Error {
  constructor(
    message: string,
    readonly tipo: string,
  ) {
    super(message)
  }
}

const cliente = config.anthropicApiKey
  ? new Anthropic({ apiKey: config.anthropicApiKey })
  : null

export interface ResultadoIA {
  texto: string
  tokensEntrada: number
  tokensSalida: number
  modelo: string
  promptUsado: string
}

interface Contexto {
  clinicaId: string
  profesionalId: string | null
  funcion: 'interpretacion_labs' | 'nota_soap'
}

/**
 * El registro del consumo NUNCA tumba la peticion.
 *
 * Si la tabla del medidor falla, el profesional debe seguir viendo su
 * interpretacion: perder la anotacion contable es molesto, perder la
 * salida clinica que ya se pago es peor.
 */
async function registrarUso(
  ctx: Contexto,
  datos: {
    modelo: string
    tokensEntrada: number
    tokensSalida: number
    exito: boolean
    errorTipo?: string
  },
): Promise<void> {
  try {
    await pool.query(
      `insert into uso_ia (clinica_id, profesional_id, funcion, modelo,
                           tokens_entrada, tokens_salida, exito, error_tipo)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        ctx.clinicaId,
        ctx.profesionalId,
        ctx.funcion,
        datos.modelo,
        datos.tokensEntrada,
        datos.tokensSalida,
        datos.exito,
        datos.errorTipo ?? null,
      ],
    )
  } catch (e) {
    console.error('[IA] no se pudo registrar el consumo:', e)
  }
}

export async function llamarClaude(prompt: string, ctx: Contexto): Promise<ResultadoIA> {
  if (!cliente) {
    throw new IaNoDisponibleError(
      'Las funciones de IA no estan configuradas en este servidor',
      'sin_configurar',
    )
  }

  const modelo = config.anthropicModelo

  try {
    const respuesta = await cliente.messages.create(
      {
        model: modelo,
        // La especificacion daba 1024. Una interpretacion de 600 palabras
        // en espanol no cabe: se cortaria a media frase, en la seccion de
        // seguimiento prioritario, que es la que mas importa.
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      },
      // En milisegundos en el SDK de TypeScript. Una espera indefinida
      // deja al profesional mirando un spinner sin salida.
      { timeout: 60_000 },
    )

    const texto = respuesta.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    const tokensEntrada = respuesta.usage.input_tokens
    const tokensSalida = respuesta.usage.output_tokens

    // El modelo puede negarse; devolver la cadena vacia como si fuera
    // una interpretacion mostraria un panel en blanco sin explicacion.
    if (respuesta.stop_reason === 'refusal' || texto === '') {
      await registrarUso(ctx, {
        modelo,
        tokensEntrada,
        tokensSalida,
        exito: false,
        errorTipo: 'sin_contenido',
      })
      throw new IaNoDisponibleError(
        'El modelo no devolvio contenido para estos datos',
        'sin_contenido',
      )
    }

    await registrarUso(ctx, { modelo, tokensEntrada, tokensSalida, exito: true })
    console.log(
      '[IA] modelo=%s entrada=%d salida=%d funcion=%s',
      respuesta.model,
      tokensEntrada,
      tokensSalida,
      ctx.funcion,
    )

    return { texto, tokensEntrada, tokensSalida, modelo: respuesta.model, promptUsado: prompt }
  } catch (e) {
    if (e instanceof IaNoDisponibleError) throw e

    // Clases tipadas del SDK, de la mas concreta a la mas general: el
    // texto del mensaje no es un contrato y cambia entre versiones.
    let tipo = 'desconocido'
    if (e instanceof Anthropic.AuthenticationError) tipo = 'credencial_invalida'
    else if (e instanceof Anthropic.RateLimitError) tipo = 'limite_de_uso'
    else if (e instanceof Anthropic.APIConnectionTimeoutError) tipo = 'tiempo_agotado'
    else if (e instanceof Anthropic.APIConnectionError) tipo = 'sin_conexion'
    else if (e instanceof Anthropic.APIError) tipo = `http_${e.status ?? 'sin_estado'}`

    // Se anota aunque haya fallado: una llamada que agoto el tiempo de
    // espera pudo consumir cuota igual, y el medidor debe reflejarlo.
    await registrarUso(ctx, {
      modelo,
      tokensEntrada: 0,
      tokensSalida: 0,
      exito: false,
      errorTipo: tipo,
    })
    console.error('[IA] fallo tipo=%s funcion=%s', tipo, ctx.funcion, e)

    throw new IaNoDisponibleError('El servicio de IA no esta disponible ahora mismo', tipo)
  }
}
