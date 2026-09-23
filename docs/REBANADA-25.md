# NutriSmart · Rebanada 25 — Perfil y fondo del paciente

**Objetivo:** que el paciente decida cómo quiere que le llamen, ponga su foto y elija el fondo de su aplicación. Materializa **PAC-09**.

**Migración 028.** El encargo dejaba el número abierto (`0NN`); la última aplicada era la 027.

---

## El conflicto que había que resolver primero

El encargo abre con una regla:

> «Colores vía CSS vars o Tailwind design tokens — nunca hex hardcodeado»

y treinta líneas después define los siete temas con veintiún valores hexadecimales (`#059669`, `#0284c7`, `#7c3aed`…) y clases de la paleta por defecto de Tailwind (`from-emerald-50`, `to-teal-100`) que no existen en el design system. Contradice también la regla de oro del proyecto: *«white-label por tokens: nunca hardcodees colores de marca»*.

No es un detalle de estilo. Los acentos que propone son, literalmente, los mismos valores que las paletas de marca ya curadas: `#059669` es `esmeralda`, `#0284c7` es casi `teal-fresco`, `#e11d48` es `coral-calido`. Aplicarlos como el encargo pedía habría hecho que **elegir un fondo cambiase la marca de la clínica**: una clínica esmeralda se volvería azul porque su paciente eligió «Calma».

### Cómo quedó

Los siete temas son bloques `[data-fondo="…"]` en `packages/design-system/tokens.css`, exactamente el mismo mecanismo que las paletas `[data-brand="…"]` que ya existían. En el código de la aplicación no hay ni un color: `lib/temas.ts` tiene claves y etiquetas, nada más.

Y cada tema mueve **solo** el fondo:

| Toca | No toca |
|---|---|
| `--background` (el tinte de página) | `--primary`, `--primary-hover`, `--primary-tint` |
| `--fondo-desde` / `--fondo-hasta` (el degradado de bienvenida) | `--status-*`, `--chart-*` |

La marca es de la clínica; el fondo es del paciente. Los botones y las acciones siguen siendo del color de la clínica en los siete temas.

---

## Decisiones tomadas

### 1. El fondo se aplica solo, en las ocho pantallas

Las siete pantallas existentes ya pintaban `<main className="bg-background">`. Como el tema redefine ese token, **ninguna de ellas se tocó**: basta poner `data-fondo` en `<html>`, igual que `data-brand`.

El hook se llama desde `NavBar` — el único componente que aparece en todas las pantallas con sesión y en ninguna sin ella. Si se llamara desde cada página, entrar directo a `/registros` se vería con el fondo de fábrica hasta pasar por Inicio.

### 2. «Oscuro» es el modo oscuro entero, no un degradado oscuro

El encargo definía `noche` como `from-slate-800 to-slate-900` y nada más. Eso deja tarjetas blancas y texto oscuro sobre un fondo casi negro: ilegible. `[data-fondo="noche"]` invierte también superficies, bordes, tinta y los ejes de las gráficas.

### 3. Las preferencias no van en el expediente

`configuracion_paciente`, no `paciente`. El expediente lo escribe la clínica y es documentación clínica; esto son preferencias del paciente sobre su propia aplicación. Meterlas en la misma tabla dejaría al paciente escribiendo en su expediente.

Por eso `nombre_preferido` **no sustituye** a `paciente.nombre`: si alguien se llama María Fernández pero todo el mundo le dice Mari, la app dice Mari y el informe clínico sigue diciendo María Fernández. La pantalla de perfil enseña el nombre del expediente, sin poder editarlo, y dice a quién avisar si está mal.

### 4. `null` explícito borra; ausente no toca

Sin distinguirlos no habría forma de quitar una foto: mandar `null` se leería igual que no mandar nada. Se distingue con `'fotoUrl' in body`.

Lo mismo en el `PATCH` de configuración: cambiar el modo del diario no puede resetear el fondo. Si el endpoint exigiera los dos campos, el selector de fondo tendría que reenviar el modo del diario, y a la larga uno pisaría al otro.

### 5. La foto solo por `https://`

El encargo validaba con `new URL(foto_url)`, que acepta `http:`, `data:` y `javascript:`. Ese valor acaba en el atributo `src` de un `<img>` de la aplicación. Se aceptan únicamente URLs `https`, con un límite de 500 caracteres, comprobado tanto en la API como con un `CHECK` en la tabla.

La pantalla dice además que la imagen se carga desde donde esté alojada y no se copia a NutriSmart: el sitio que la sirve ve que alguien la pide.

### 6. El avatar cae a las iniciales cuando la foto falla

Es una dirección externa: que algún día deje de responder no es la excepción, es lo esperable. Sin esto quedaría el icono roto del navegador.

### 7. El fondo se pinta antes de que conteste el servidor

Es una preferencia visual. Esperar el viaje de ida y vuelta hace que el selector parezca roto. Si la petición falla, se vuelve al anterior.

### 8. El selector de fondos no repite ni un color

Cada muestra es un `<span data-fondo="…" className="fondo-hero">`: se pinta con las variables de su propio tema. Si mañana se retoca un verde en el design system, el selector lo refleja solo.

### 9. El perfil no es una sexta pestaña

Se llega desde el avatar de la cabecera de Inicio. La barra inferior sigue con cinco, como se decidió en la R23.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| `apps/api/src/db/migrations/` | `apps/api/migrations/` |
| `schema_migrations.migration_name` | `version` |
| Tabla `recurso_pac` (comprobación de prerequisitos) | `recurso` — la R24 sí está |
| `app.authenticate` · `req.user.sub` | `requireAuthPaciente` · `request.authPac.sub` |
| `var(--color-primary)`, `--color-text`, `--color-text-muted` | `--primary`, `--ink`, `--muted` |
| `foto_url`, `nombre_preferido` en el cuerpo JSON | `fotoUrl`, `nombrePreferido` — camelCase, como el resto de la API |
| `InicioPage.tsx`, `PerfilPage.tsx` | `Inicio.tsx`, `Perfil.tsx` |
| Fondo solo en la cabecera de Inicio | Tinte de página en las ocho pantallas + degradado en la bienvenida |

**Una regla del encargo que no se siguió:** «nunca `to_char()` en campos TIMESTAMPTZ». Esta rebanada no devuelve ninguna fecha, así que no se aplicaba; se deja anotado porque contradice la convención fijada en la R21, donde `to_char(… 'Z')` se adoptó tras un fallo real (`OF` producía `+00`, que `new Date()` no sabe leer). Cambiarla ahora obligaría a tocar los 21 sitios que la usan.

---

## Contrato de API

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/paciente/configuracion` | Modo del diario, fondo, foto, nombre visible y nombre del expediente |
| `PATCH` | `/api/paciente/configuracion` | `modoDiario` y/o `fondo` — parcial |
| `PATCH` | `/api/paciente/perfil` | `fotoUrl` y/o `nombrePreferido`; `null` borra |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 25.
