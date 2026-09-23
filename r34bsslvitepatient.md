# R34b — HTTPS local para web-patient (SSL dev)

## Contexto

Se instaló `@vitejs/plugin-basic-ssl` en `apps/web-patient` para habilitar HTTPS en desarrollo local. Esto es necesario porque la Web Crypto API (usada por Keycloak PKCE) no está disponible en HTTP con IP de red local — solo en HTTPS o en `localhost`.

## Cambio requerido

Edita `apps/web-patient/vite.config.ts` para agregar el plugin de SSL.

### Paso 1 — Leer el archivo actual

```bash
cat apps/web-patient/vite.config.ts
```

### Paso 2 — Agregar el plugin

Al inicio del archivo, agrega el import:

```ts
import basicSsl from '@vitejs/plugin-basic-ssl'
```

Dentro del array `plugins: [...]`, agrega `basicSsl()` como primer elemento. Ejemplo:

```ts
plugins: [
  basicSsl(),
  react(),
  // ...resto de plugins que ya existan
],
```

No elimines ningún plugin existente. Solo agrega `basicSsl()` al inicio del array.

### Paso 3 — Verificar

Ejecuta:

```bash
cd apps/web-patient && npx vite --host
```

Debe aparecer algo como:

```
➜  Local:   https://localhost:5175/
➜  Network: https://192.168.100.94:5175/
```

Con `https://` en lugar de `http://`.

## Qué NO tocar

- No modifiques `apps/web-professional/vite.config.ts`
- No cambies el puerto
- No toques ningún otro archivo
