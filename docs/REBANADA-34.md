# Rebanada 34 — Navegación con el color de la clínica (APP-BRAND-01)

La barra lateral y la superior de la app profesional, y la barra inferior
de la app del paciente, pasan de fondo blanco a **el color de marca de la
clínica**. No hay migración ni cambios de API: es presentación.

Hasta ahora el white-label se notaba en botones, badges y acentos. Ahora
se ve al entrar.

---

## El problema que aparece al llenar la barra de color

El encargo decía «fondo primario, texto blanco». El texto blanco es
justamente lo que no se sostiene.

Mientras el primario ocupaba botones pequeños, el blanco encima valía
para todo. Al convertirlo en el fondo de la navegación entera, el
contraste pasa a ser una condición de uso, y **tres de las ocho paletas
del propio design system no lo cumplen**:

| Paleta | Blanco sobre el primario |
|---|---|
| teal-fresco `#0891B2` | 3.68:1 ✗ |
| esmeralda `#059669` | 3.77:1 ✗ |
| ámbar `#D97706` | 3.19:1 ✗ |

WCAG AA pide 4.5:1 para texto normal. Un menú que no se lee no es un
detalle estético: es la navegación de la aplicación.

Y arreglar esas tres a mano no serviría, porque desde la Rebanada 6 la
clínica puede inyectar **cualquier** color desde Ajustes → Marca. El
siguiente color ilegible no está en ninguna lista.

### La solución

> **Corregida en la Rebanada 35b.** La primera versión resolvía esto
> oscureciendo la **tinta** donde el blanco no llegaba, y en esas tres
> paletas el menú salía con letra oscura. Se sustituyó por oscurecer el
> **fondo** lo justo para que el blanco valga siempre. El razonamiento
> completo está en `REBANADA-35B.md`; lo que sigue describe el resultado
> final.

El fondo de las barras deja de ser `--primary` y pasa a ser `--nav`: el
mismo color de marca, escalado hacia el negro lo justo para que el texto
blanco de encima llegue a 4.5:1.

Cinco de las ocho paletas salen **intactas** —ya cumplían— y tres bajan
un punto:

| Paleta | Marca | Barra | Blanco encima |
|---|---|---|---|
| por defecto `#0E7C66` | = | `#0E7C66` | 5.13:1 |
| azul-clínico `#2563EB` | = | `#2563EB` | 5.17:1 |
| teal-fresco `#0891B2` | ↓ | `#07809D` | 4.58:1 |
| esmeralda `#059669` | ↓ | `#05875E` | 4.53:1 |
| índigo `#4F46E5` | = | `#4F46E5` | 6.29:1 |
| coral-cálido `#E11D48` | = | `#E11D48` | 4.70:1 |
| ámbar `#D97706` | ↓ | `#B26205` | 4.52:1 |
| grafito `#334155` | = | `#334155` | 10.35:1 |

Y funciona para cualquier color inyectado, no solo para estos ocho: un
amarillo `#FFE066` acaba en un oliva `#857435` (4.62:1), y el blanco puro
en un gris `#757575` (4.61:1).

## Otras decisiones

### `bg-white/20` y compañía

Al garantizar el contraste por el fondo, el blanco vale siempre y las
clases de Tailwind se pueden usar tal cual: `text-white`, `text-white/70`,
`bg-white/20`, `hover:bg-white/10`, `border-white/20`. Funcionan porque
`white` es un color literal — el modificador de opacidad **no** habría
funcionado sobre un color declarado como `var(…)`, que es justo lo que
obligó a la primera versión a montar clases propias en el CSS global.

### El item activo conserva su borde

El resaltado del menú era `border-l-4 border-primary bg-primary-tint`.
Pasa a `bg-white/20`, pero **el borde izquierdo se queda** —ahora en
blanco—: la sección actual no puede distinguirse solo por un tono de
fondo.

### El color de la clínica, en toda la app del paciente

Se aplicaba únicamente en Inicio, la única pantalla que pedía
`/api/paciente/yo`. Con la barra teñida eso se vuelve visible: saldría
con el color de la clínica en Inicio y con el verde por defecto en Plan,
Citas o Mensajes.

Se movió a `lib/marca.ts`, con el mismo patrón de promesa cacheada que
`usePerfil`, y lo dispara la `NavBar` — el único componente presente en
todas las pantallas con sesión y en ninguna sin ella. Es el mismo
razonamiento que ya estaba escrito ahí para el fondo del paciente.

### Piezas que quedaban descolgadas

- **La campana de notificaciones** llevaba `text-muted`: un icono gris
  sobre color de marca. Va en blanco como el resto de la barra.
- **El panel de notificaciones** cuelga del DOM de la barra superior; se
  le puso `text-ink` explícito para que no herede el blanco.
- **El contador de mensajes sin leer** del paciente iba en `--primary`
  sobre barra blanca. Sobre la barra teñida se habría fundido con el
  fondo: va invertido, círculo blanco y número en el color de la barra.
- **La inicial de la clínica** (cuando no hay logo) iba en `bg-primary`,
  que sobre el propio primario desaparece.

### Lo que no se tocó

De `tokens.css` solo se añade `--nav`, con el valor por defecto que ya
cumple. Tampoco cambian las tarjetas, tablas ni fondos de sección, ni
`brand_config`, ni el selector de paletas, ni la carga del perfil.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `design-system/tokens.css` | token `--nav` |
| `web-professional/lib/color.ts` | `fondoNav()` y `nav` en la paleta derivada |
| `web-professional/contexts/BrandContext.tsx` | escribe `--nav` en `:root` |
| `web-professional/components/Shell.tsx` | barra lateral y superior con color de marca |
| `web-professional/…/NotificacionesCampana.tsx`, `…Panel.tsx` | tinta heredada / `text-ink` explícito |
| `web-patient/lib/marca.ts` | **nuevo** — misma regla de fondo, y aplicación del color en toda la app |
| `web-patient/components/NavBar.tsx` | barra inferior con color de marca |
| `web-patient/pages/Inicio.tsx` | usa `aplicarMarca()` |
