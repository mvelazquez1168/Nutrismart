/**
 * Bioquímica con lectura nutricional — EVAL-02.
 *
 * Sin tabla nueva: relee los laboratorios de la Rebanada 5 y los
 * presenta agrupados para la valoración.
 *
 * Se reutiliza `listarEstudios`, que ya resuelve el rango de referencia
 * por clínica y sexo, el estado y la tendencia. Reimplementar esa lógica
 * aquí produciría una pantalla que discrepa de la de Laboratorios sobre
 * el mismo valor.
 *
 * El grupo sale del CATÁLOGO (`biomarcador.grupo`), no de listas de
 * nombres escritas en el código: el catálogo ya trae perfil lipídico,
 * glucémico, hematología, vitaminas… y un biomarcador nuevo queda
 * clasificado sin tocar nada.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { listarEstudios, type EstadoResultado } from '../laboratorios/repositorio.js'

/**
 * Lectura fina del estado.
 *
 * La Rebanada 5 distingue `normal`, `alterado` y `sin_referencia`. Para
 * valorar hace falta saber hacia DÓNDE se sale del rango: una ferritina
 * baja y una alta no cuentan la misma historia.
 *
 * No hay nivel `critico`: el valor de pánico depende del contexto
 * clínico y de umbrales que este proyecto sitúa en el motor de
 * monitoreo (RPM). Inventarlo aquí sería una alarma sin criterio detrás.
 */
export type EstadoNutricional = 'normal' | 'bajo' | 'alto' | 'sin_referencia'

function afinar(
  estado: EstadoResultado,
  valor: number,
  rango: { minimo: number | null; maximo: number | null } | null,
): EstadoNutricional {
  if (estado !== 'alterado' || !rango) return estado === 'alterado' ? 'alto' : estado
  if (rango.minimo !== null && valor < rango.minimo) return 'bajo'
  if (rango.maximo !== null && valor > rango.maximo) return 'alto'
  return 'normal'
}

export async function registerBioquimicaRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { dias?: string } }>(
    '/api/pacientes/:id/labs/nutricional',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) {
        return reply.code(403).send({
          error: 'profesional_no_encontrado',
          message: 'Tu usuario no tiene un profesional asociado en esta clínica',
        })
      }

      const pedido = Number(request.query.dias)
      const dias = Number.isInteger(pedido) && pedido > 0 ? Math.min(pedido, 3650) : 90

      const estudios = await listarEstudios(tenantId, alcance.restringirA, request.params.id)
      if (estudios === null) {
        return reply
          .code(404)
          .send({ error: 'paciente_no_encontrado', message: 'No se encontró el paciente' })
      }

      // El corte se hace por la fecha de TOMA DE MUESTRA, no por la de
      // captura: un informe de hace tres meses cargado ayer sigue
      // describiendo al paciente de hace tres meses.
      const limite = new Date()
      limite.setUTCDate(limite.getUTCDate() - dias)
      const desde = limite.toISOString().slice(0, 10)
      const recientes = estudios.filter((e) => e.fecha >= desde)

      const { rows: catalogo } = await pool.query<{ codigo: string; grupo: string }>(
        'select codigo, grupo from biomarcador',
      )
      const grupoDe = new Map(catalogo.map((b) => [b.codigo, b.grupo]))

      /*
       * Solo el valor MÁS RECIENTE de cada biomarcador.
       *
       * Un paciente con tres hemogramas en el trimestre tendría tres
       * hemoglobinas en la tabla, y quien valora acabaría comparándolas
       * entre sí en lugar de leer el estado actual. El histórico ya
       * está en la pestaña de Laboratorios.
       */
      const porCodigo = new Map<
        string,
        {
          codigo: string
          nombre: string
          unidad: string
          valor: number
          rango: { minimo: number | null; maximo: number | null } | null
          estado: EstadoNutricional
          tendencia: string | null
          fecha: string
          grupo: string
        }
      >()

      // Los estudios llegan del más reciente al más antiguo, así que el
      // primero que aparece de cada código es el vigente.
      for (const estudio of recientes) {
        for (const r of estudio.resultados) {
          if (porCodigo.has(r.codigo)) continue
          porCodigo.set(r.codigo, {
            codigo: r.codigo,
            nombre: r.nombre,
            unidad: r.unidad,
            valor: r.valor,
            rango: r.rango,
            estado: afinar(r.estado, r.valor, r.rango),
            tendencia: r.tendencia,
            fecha: estudio.fecha,
            grupo: grupoDe.get(r.codigo) ?? 'Otros',
          })
        }
      }

      const marcadores = [...porCodigo.values()]

      // Agrupados en el orden del catálogo, no alfabético: el catálogo
      // ya los ordena como se leen en un informe.
      const grupos = new Map<string, typeof marcadores>()
      for (const m of marcadores) {
        const lista = grupos.get(m.grupo) ?? []
        lista.push(m)
        grupos.set(m.grupo, lista)
      }

      const alterados = marcadores.filter((m) => m.estado === 'bajo' || m.estado === 'alto')

      return reply.send({
        dias,
        fechaMasReciente: recientes[0]?.fecha ?? null,
        totalMarcadores: marcadores.length,
        marcadoresAlterados: alterados.length,
        // Se envían aparte para que la interfaz pinte el resumen sin
        // recorrer los grupos.
        alterados: alterados.map((m) => ({ codigo: m.codigo, nombre: m.nombre, estado: m.estado })),
        grupos: [...grupos.entries()].map(([nombre, lista]) => ({
          nombre,
          marcadores: lista,
          // La interfaz despliega solo lo que tiene algo que mirar.
          tieneAlterados: lista.some((m) => m.estado === 'bajo' || m.estado === 'alto'),
        })),
      })
    },
  )
}
