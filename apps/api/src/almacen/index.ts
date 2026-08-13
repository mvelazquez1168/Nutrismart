/**
 * Punto unico de acceso al almacen.
 *
 * El codigo de negocio importa `almacen` y nunca una implementacion
 * concreta. Cambiar a S3 es anadir una clase que cumpla la interfaz y
 * elegirla aqui; ni las rutas ni los repositorios se enteran.
 */
import { config } from '../config.js'
import { AlmacenLocal } from './local.js'
import type { AlmacenArchivos } from './tipos.js'

export const almacen: AlmacenArchivos = new AlmacenLocal(config.archivosDir)

export * from './tipos.js'
export * from './deteccion.js'
