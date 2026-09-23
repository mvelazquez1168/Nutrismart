# NutriSmart · Rebanada 31 — Pantalla de acceso propia y paletas curadas

**Objetivo:** que lo primero que se vea sea la aplicación y no la pantalla genérica de Keycloak, y que elegir los colores de una clínica no permita elegir mal. Materializa **LOGIN-01**.

**Sin migraciones.**

---

## Parte A · La pantalla de acceso

Con `onLoad: 'login-required'`, Keycloak se lleva al usuario a su propia pantalla antes de que el navegador pinte nada. No hay ocasión de enseñar nada propio.

Con `check-sso` la aplicación arranca, comprueba en un iframe oculto si ya hay sesión, y solo si no la hay pinta su pantalla.

### Lo que esa pantalla NO hace

**No pide credenciales.** El usuario y la contraseña se escriben en Keycloak, que es quien los verifica. Un formulario propio que los recogiera para mandárselos después convertiría esta página en un sitio que ve las contraseñas de todo el mundo — exactamente lo que el flujo de código de autorización evita. Aquí solo hay un botón.

**No lleva la marca de la clínica.** Sin sesión no hay `tenant_id`: no se sabe de qué clínica es quien mira. Se pinta la identidad de la plataforma, con los tokens del design system. El logo de la clínica aparece en cuanto entra.

### El caso que conviene tener presente

La comprobación silenciosa usa **cookies de terceros**, y Safari las bloquea por defecto. Ahí el iframe termina sin sesión aunque el usuario la tenga, y verá la pantalla de acceso otra vez. Pulsar el botón lo resuelve —Keycloak reconoce su sesión y vuelve sin pedir contraseña— pero es la clase de cosa que alguien reporta como fallo.

Queda anotado en el propio código, junto al `init`.

### Un cambio que había que hacer en el `AuthProvider`

Trataba «sin sesión» como error, porque con `login-required` no se llegaba ahí nunca. Ahora es un estado normal: `anonimo`.

---

## Parte B · No se tocó nada

El logo de la clínica **ya estaba** en la barra lateral desde la Rebanada 6: `object-contain` con altura fija para que un logo apaisado y uno cuadrado convivan sin deformarse, y respaldo a la inicial del nombre cuando no hay logo.

---

## Parte C · Las paletas salen del design system

El encargo definía **diez paletas nuevas** con sus hexadecimales en un archivo TypeScript. Dos problemas:

**Ya existen.** `packages/design-system/tokens.css` trae las paletas curadas que pide la regla del proyecto («8 paletas curadas»), como bloques `[data-brand="…"]`. Añadir otra lista habría dejado dos juegos de colores curados que nadie mantendría iguales.

**Contradecía su propia regla 5**: «colores vía CSS vars / tokens Tailwind, nunca hex en línea en JSX».

Aquí se leen **en tiempo de ejecución**: se monta un elemento oculto con `data-brand="…"` y se pregunta al navegador qué valor toma `--primary` dentro. Una sola fuente de verdad; si mañana se retoca un color en el design system, el selector lo refleja sin tocar nada. Es el mismo recurso que usa el selector de fondos del paciente (R25).

### El color libre no se quita

El encargo lo reemplazaba. Pero la regla del proyecto admite las dos vías —paleta curada **o** color inyectado— y hay clínicas con un manual de marca que cumplir.

Las paletas van primero, que es el camino recomendado; el color exacto queda plegado detrás de «Usar los colores exactos de mi marca». El aviso de contraste WCAG de la R6 sigue vigilándolo, que es lo que de verdad protege: avisa cuando el texto blanco no se lee sobre el color elegido.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| `brand_config.color_secundario` | **`color_acento`** |
| Logo de clínica por hacer | Ya estaba desde la R6 |
| `.env` dentro de cada app | El `.env` vive en la raíz del repo |
| `--color-primary`, `--color-text`, `--color-bg` | `--primary`, `--ink`, `--background` |
| El paciente ya usaba `check-sso` | Cierto, pero **sin** comprobación silenciosa: hacía una redirección completa |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 31.
