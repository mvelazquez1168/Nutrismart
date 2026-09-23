import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
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
 * HTTPS es OPCIONAL y va detrás de `DEV_HTTPS=1`, no de que existan los
 * certificados. El motivo: Keycloak se sirve por HTTP, y una página
 * cargada por HTTPS no puede hacerle la petición del token — el
 * navegador la bloquea por contenido mixto y el login no termina.
 *
 * Mientras la aplicación no registre un service worker, HTTP en la red
 * local basta para probar en el móvil. El día que haya PWA habrá que
 * poner también Keycloak detrás de HTTPS, y entonces esta variable pasa
 * a ser lo normal.
 */
const certs = resolve(__dirname, '../../certs')
const cert = resolve(certs, 'local-cert.pem')
const key = resolve(certs, 'local-key.pem')
const hayCerts = existsSync(cert) && existsSync(key)
const usarHttps = process.env['DEV_HTTPS'] === '1' && hayCerts


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
  plugins: [react()],
  server: {
    port: 5173,
    // El cliente nutrismart-web de Keycloak tiene registrado
    // http://localhost:5173/* como redirectUri. Si Vite cambia de puerto
    // al estar ocupado, el login falla con "Invalid redirect_uri", asi
    // que preferimos que avise en vez de moverse solo.
    strictPort: true,
    // Accesible desde la red local, para revisar la pantalla del
    // profesional en una tableta.
    host: true,
    ...(usarHttps
      ? { https: { cert: readFileSync(cert), key: readFileSync(key) } }
      : {}),
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
  // El .env vive en la raiz del repo, no en apps/web-professional.
  // Vite solo expone al navegador las variables con prefijo VITE_.
  envDir: resolve(__dirname, '../..'),
})
