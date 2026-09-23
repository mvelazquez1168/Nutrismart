import { defineConfig, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Certificados de desarrollo para probar en un móvil de verdad.
 *
 * Se generan con mkcert (ver `docs/PRUEBAS-MOVIL.md`) y NO están en el
 * repositorio. Si no existen, el servidor arranca en HTTP normal: es lo
 * que necesita quien solo trabaja en su ordenador, y hace que clonar el
 * proyecto no dependa de tener mkcert instalado.
 *
 * HTTPS es OPCIONAL y va detrás de `DEV_HTTPS=1`. Sigue sin ser lo
 * normal por dos razones, aunque ya no por la de antes —el contenido
 * mixto desapareció al meter Keycloak por el proxy de Vite, ver más
 * abajo—:
 *
 * 1. Las direcciones de vuelta del cliente `nutrismart-patient` están
 *    registradas en Keycloak. Servir por https sin querer cambia el
 *    origen y el login termina en «Invalid redirect_uri», un error que
 *    no menciona el esquema por ningún sitio.
 * 2. Trabajar en el ordenador no necesita HTTPS, y no tiene por qué
 *    obligar a instalar mkcert.
 *
 * En el móvil sí hace falta, y no por la PWA: la Web Crypto API que
 * Keycloak usa para PKCE solo existe en contextos seguros. Por HTTP y
 * con una IP de red local, `crypto.subtle` no está definido y el botón
 * de entrar no hace absolutamente nada, sin error en pantalla.
 */
const certs = resolve(__dirname, '../../certs')
const cert = resolve(certs, 'local-cert.pem')
const key = resolve(certs, 'local-key.pem')
const hayCerts = existsSync(cert) && existsSync(key)
const pedirHttps = process.env['DEV_HTTPS'] === '1'
const usarHttps = pedirHttps && hayCerts

/**
 * Certificado de emergencia, cuando se pide HTTPS y no hay mkcert.
 *
 * `@vitejs/plugin-basic-ssl` genera uno autofirmado al vuelo. Sirve para
 * lo único que importa aquí —que el navegador considere la página un
 * contexto seguro y exponga `crypto.subtle`— a cambio de un aviso de
 * seguridad que hay que aceptar en cada navegador.
 *
 * ── Por qué va condicionado y no suelto en `plugins` ────────────────
 *
 * El plugin no añade: pisa. Su `configResolved` hace
 *
 *     if (config.server.https === undefined || !!config.server.https)
 *       config.server.https = Object.assign({}, config.server.https, suyo)
 *
 * de modo que puesto sin condición rompe los dos casos que ya
 * funcionaban:
 *
 * - Con `DEV_HTTPS=1` y certificados de mkcert, los sobrescribe con el
 *   suyo. Y ahí la diferencia es todo: el de mkcert lo firma una
 *   autoridad que el móvil tiene instalada y el navegador lo acepta sin
 *   rechistar; el autofirmado da «esta conexión no es privada» y en iOS
 *   no hay forma de arreglarlo, porque se regenera dentro de
 *   `node_modules/.vite` y no es una CA que se pueda dar por buena.
 * - Sin `DEV_HTTPS`, la rama `=== undefined` obliga a HTTPS SIEMPRE,
 *   también al trabajar en el ordenador. Y entonces el origen deja de
 *   coincidir con lo registrado en Keycloak: «Invalid redirect_uri».
 *
 * Es decir, es el respaldo, no la vía principal. Para el móvil sigue
 * siendo mejor mkcert (`docs/PRUEBAS-MOVIL.md`).
 */
const ssl: Plugin[] = pedirHttps && !hayCerts ? [basicSsl()] : []


/**
 * Proxy a Keycloak con reescritura de las direcciones que devuelve.
 *
 * `changeOrigin` hace que Keycloak vea `Host: localhost:8080`, y eso es
 * bueno para una cosa —firma los tokens con el issuer de siempre, sin
 * tocar la API— y muy malo para otra: TODAS las direcciones absolutas
 * que genera (el `action` del formulario de login, las redirecciones,
 * los enlaces de "olvidé mi contraseña") apuntan a `localhost:8080`.
 *
 * En el ordenador da igual. En un móvil, `localhost` es el propio
 * teléfono: se ve la pantalla de login, se meten las credenciales y
 * Safari dice «no se pudo conectar con el servidor».
 *
 * La alternativa —quitar `changeOrigin` para que Keycloak vea el Host
 * real— exige configurarle `KC_PROXY_HEADERS` para que respete el
 * esquema https, y ese contenedor lo comparte otro proyecto.
 *
 * Así que se reescribe la respuesta: donde Keycloak diga
 * `http://localhost:8080`, el navegador lee la dirección por la que
 * llegó. Se toca la cabecera `Location` y el cuerpo HTML.
 */
function proxyKeycloak(): ProxyOptions {
  const interno = 'http://localhost:8080'
  return {
    target: interno,
    changeOrigin: true,
    // Necesario para poder tocar el cuerpo antes de enviarlo.
    selfHandleResponse: true,
    configure(proxy) {
      proxy.on('proxyRes', (proxyRes, req, res) => {
        const publico = `${'encrypted' in req.socket && req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`
        const cabeceras = { ...proxyRes.headers }

        if (typeof cabeceras['location'] === 'string') {
          cabeceras['location'] = cabeceras['location'].split(interno).join(publico)
        }

        const tipo = String(cabeceras['content-type'] ?? '')
        const esTexto = /text\/html|application\/json|text\/css|javascript/.test(tipo)

        if (!esTexto) {
          res.writeHead(proxyRes.statusCode ?? 200, cabeceras)
          proxyRes.pipe(res)
          return
        }

        const trozos: Buffer[] = []
        proxyRes.on('data', (c: Buffer) => trozos.push(c))
        proxyRes.on('end', () => {
          const cuerpo = Buffer.concat(trozos).toString('utf8').split(interno).join(publico)
          // El tamaño cambia al reescribir: sin recalcularlo, el
          // navegador se queda esperando bytes que no llegan.
          delete cabeceras['content-length']
          res.writeHead(proxyRes.statusCode ?? 200, {
            ...cabeceras,
            'content-length': Buffer.byteLength(cuerpo),
          })
          res.end(cuerpo)
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [...ssl, react()],
  // El .env vive en la raiz del repo, como en la app profesional: una
  // sola copia de la configuracion para las dos aplicaciones.
  envDir: resolve(__dirname, '../..'),
  server: {
    port: 5175,
    // Si el puerto esta ocupado, fallar en vez de moverse solo.
    //
    // Vite, por defecto, se pasa al siguiente libre — y entonces la
    // vuelta del login va a un puerto que Keycloak no tiene registrado y
    // el error que sale ("Invalid redirect_uri") no dice nada del puerto.
    // Mas vale que avise al arrancar. Mismo criterio que en la app
    // profesional.
    strictPort: true,
    // Accesible desde la red local para probarla en un movil de verdad,
    // que es donde va a vivir esta aplicacion.
    host: true,
    ...(usarHttps
      ? { https: { cert: readFileSync(cert), key: readFileSync(key) } }
      : {}),
    /**
     * La API se sirve por el MISMO origen que la aplicación.
     *
     * Desde el móvil, `http://localhost:4001` es el propio teléfono. Con
     * el proxy, la app pide `/api/...` a quien la sirvió y Vite lo
     * reenvía a la API; así el teléfono no necesita conocer el puerto
     * 4001, no hay que abrirlo en el cortafuegos, y de paso desaparece
     * el CORS: mismo origen.
     *
     * Para que esto funcione, `VITE_API_URL` tiene que quedar VACÍA (ver
     * `.env.local`). Si apunta a un host absoluto, el proxy no se usa.
     */
    proxy: {
      '/api': { target: 'http://localhost:4001', changeOrigin: true },
      /**
       * Keycloak, por el mismo origen que la aplicación.
       *
       * Tres problemas se resuelven de una vez:
       *
       * 1. El puerto 8080 de esta máquina lo ocupa además un Apache, que
       *    es quien responde desde la IP de red — Keycloak solo gana en
       *    `localhost`. Yendo por el proxy se llega siempre al correcto.
       * 2. No hay que abrir el 8080 en el cortafuegos.
       * 3. Con `changeOrigin`, Keycloak ve `Host: localhost:8080` y firma
       *    el token con el issuer de siempre. Nada que añadir en la API.
       *
       * `/resources` son los CSS e imágenes de la pantalla de login de
       * Keycloak: sin proxy, el navegador los pediría a Vite y la
       * pantalla saldría sin estilos.
       */
      '/realms': proxyKeycloak(),
      '/resources': proxyKeycloak(),
    },
  },
})
