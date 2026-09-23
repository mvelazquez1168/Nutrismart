# Rebanada 35b — Texto blanco en toda la navegación

Corrige la Rebanada 34. El resultado que se pedía —**todo el texto de las
barras en blanco**— es el que ahora se entrega; lo que cambia es por dónde
se consigue.

---

## Qué pasaba

La R34 dejaba las barras con el color de la clínica y **elegía la tinta**:
blanco donde se leía, oscura donde no. En la práctica eso significa que
con las paletas claras —teal, esmeralda, ámbar— el menú salía con letra
oscura. Técnicamente correcto y visualmente equivocado: una barra de
navegación que cambia de color de letra según la clínica se lee como un
fallo, no como una precaución.

## Qué se hace ahora

Se invierte: **la tinta es siempre blanca, y el que cede es el fondo.**

Las barras dejan de pintarse con `--primary` y usan un token nuevo,
`--nav`: el mismo color de marca escalado hacia el negro **solo hasta
alcanzar 4.5:1** contra el blanco, y ni un paso más.

Cinco de las ocho paletas ni se enteran. Tres bajan un punto:

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

No es una tabla de casos: es lo que devuelve la función para esos ocho
colores. Vale igual para cualquier color que inyecte una clínica —un
amarillo `#FFE066` acaba en un oliva `#857435` (4.62:1); el blanco puro,
en un gris `#757575` (4.61:1)— y termina siempre, porque en el peor caso
llega al negro, que contrasta 21:1.

### Por qué escalar y no restar

Se multiplican los tres canales por el mismo factor. Eso **conserva el
tono exacto**: lo que define el tono son las proporciones entre canales,
y una multiplicación no las cambia. Restar una cantidad fija a cada uno
—que es la forma habitual de «oscurecer»— desatura: un verde intenso
menos 30 en cada componente sale gris verdoso.

### El efecto secundario, dicho claro

En las tres paletas afectadas, la barra **no muestra exactamente** el
color que el administrador eligió, sino un punto más oscuro. Es el precio
de tener el texto blanco en todas partes, y es lo que se pidió. La
diferencia es difícil de ver salvo comparando lado a lado — `#0891B2`
contra `#07809D`—, pero conviene saberlo antes de que alguien lo note y
lo reporte como fallo.

---

## Lo que se simplificó de paso

Con el blanco garantizado, todo el andamiaje que la R34 necesitaba
desaparece:

- **Fuera `--on-primary` calculado.** El token vuelve a su valor de
  siempre en `tokens.css` y deja de escribirse desde la app.
- **Fuera las clases `.nav-marca`** de los dos `index.css`. Existían
  porque Tailwind 3 no genera modificadores de opacidad sobre colores
  declarados como `var(…)` — `bg-[var(--on-primary)]/20` no existiría.
  Con blanco literal, `bg-white/20` y `hover:bg-white/10` funcionan.
- **Fuera el helper `velo()`** y los `color-mix` inline de ambos
  componentes.

El resultado es el que pedía el encargo, clase por clase: `text-white`,
`text-white/70`, `bg-white/20`, `hover:bg-white/10`, `border-white/20`.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `design-system/tokens.css` | token `--nav` con su valor por defecto |
| `web-professional/lib/color.ts` | `fondoNav()` sustituye a `tintaSobre()` |
| `web-professional/contexts/BrandContext.tsx` | escribe `--nav` en lugar de `--on-primary` |
| `web-professional/components/Shell.tsx` | clases blancas; fuera `velo()` |
| `web-professional/index.css` | fuera `.nav-marca` |
| `web-professional/…/NotificacionesCampana.tsx` | icono en blanco |
| `web-patient/lib/marca.ts` | `fondoNav()` sustituye a `tintaSobre()` |
| `web-patient/components/NavBar.tsx` | clases blancas |
| `web-patient/index.css` | fuera `.nav-marca` |
