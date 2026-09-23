# NutriSmart · Rebanada 24 — Contador de porciones y biblioteca

**Objetivo:** que el paciente pueda apuntar lo que come alimento por alimento en vez de en una frase, y que el profesional le publique material educativo. Materializa **PAC-07** y **PAC-08**.

**Migraciones 026 y 027.** El encargo pedía la 025 y la 026, ambas ocupadas por la Rebanada 23.

---

## La decisión que sostiene la rebanada: los totales se derivan

El encargo guardaba los alimentos en `registro_comida_item` y dejaba intacta la fila `registro_comida` de la Rebanada 22 —la que tiene `kcal`, `proteina_g`, `cho_g`, `grasa_g` y `descripcion`—.

Eso habría dejado dos cifras para lo mismo. La fila padre seguiría con las calorías que el paciente puso a ojo; los items dirían otra cosa. Y de la fila padre leen dos pantallas ya construidas:

- la ficha del profesional (Rebanada 22), que muestra el diario del paciente;
- la media semanal de calorías del progreso (Rebanada 23).

Ninguna de las dos sabría cuál de las dos cuentas creer, y las dos elegirían la equivocada.

Aquí la fila padre **es** la suma de sus items: un trigger recalcula totales y descripción en cuanto se añade o se quita uno. La descripción sale de concatenar los nombres, así que la ficha del profesional pasa a mostrar «Arroz blanco cocido, Pechuga de pollo» sin tocar una línea de esa pantalla. Ninguna de las dos rebanadas anteriores se modificó y las dos quedan mejor de lo que estaban.

Los dos modos conviven sobre la misma tabla porque son la misma comida contada con más o menos detalle, no dos diarios distintos.

---

## Decisiones tomadas

### 1. Se apuntan porciones, no gramos

La historia se llama «contador de porciones». Nadie tiene una báscula al lado del plato, pero todo el mundo puede decir si se comió una tortilla o dos. La pantalla ofrece ½, 1, 1½, 2 y 3 porciones sobre la porción típica de cada alimento, y muestra a cuántos gramos equivale.

Los gramos exactos siguen ahí, plegados detrás de «Lo pesé»: quien se toma la molestia de pesar merece que se le apunte bien.

### 2. Las cifras se copian al apuntar, no se leen por join

`registro_comida_item` guarda el nombre y los macros calculados, no solo el `alimento_id`. Si mañana se corrige una ficha del catálogo, lo que el paciente registró en marzo sigue diciendo lo que registró. Un diario clínico no se reescribe solo.

### 3. El servidor recalcula las calorías; no se fía del cliente

Al añadir un alimento del catálogo, la API relee sus valores y multiplica por la cantidad. Si aceptara las cifras del cuerpo de la petición, cualquiera podría apuntar una pizza con 0 kcal y el diario dejaría de valer para nada.

### 4. Se admite escribir un alimento que no está en el catálogo

Sin macros, porque no los hay. El catálogo nunca va a tenerlo todo, y obligar a elegir de una lista es la forma más segura de que alguien deje de apuntar. Una comida sin estimar ya se cuenta aparte desde la Rebanada 22.

### 5. Añadir el primer alimento crea la comida, en la misma transacción

El encargo pedía `POST /diario/:registroId/items`, que obliga a que la comida exista antes. Pero en modo detallado la descripción la calcula el trigger a partir de los alimentos: no hay nada que escribir para crearla.

Con `:registroId` el cliente tendría que crear primero una comida con una descripción inventada y confiar en que el trigger la tape — y si el paciente abandona ahí, queda un registro con texto de relleno que su nutricionista va a leer.

La ruta lleva la franja (`POST /api/paciente/diario/items`) y abre la comida junto con el alimento. O hay comida con al menos un alimento, o no hay comida.

### 6. Quitar el último alimento archiva la comida

Si no, quedaría con la descripción de antes de quitar nada: una comida que dice «arroz, pollo» cuando ya no queda ninguno de los dos es peor que ninguna comida. Lo hace la ruta y no el trigger — al llegar a cero el trigger no tiene con qué reconstruir nada, y borrar filas de otra tabla desde un trigger esconde demasiado.

### 7. El modo lo elige el paciente

Hay quien no va a apuntar alimento por alimento nunca. Forzarlo consigue que deje de apuntar del todo. `configuracion_paciente` guarda la preferencia por paciente **y clínica**: la misma persona podría ser paciente de dos y llevar el diario distinto en cada una.

### 8. El catálogo es de Costa Rica, con sinónimos regionales

46 alimentos: gallo pinto, chayote, queso turrialba, fresco natural. Los sinónimos son lo que hace que la búsqueda sirva — «jitomate» encuentra Tomate, «palta» encuentra Aguacate, «guineo» encuentra Banano.

Y la búsqueda ignora acentos, porque nadie escribe «plátano» con tilde en el móvil.

### 9. Un recurso nace como borrador

Publicar es un acto aparte y deliberado. Que un artículo a medio escribir aparezca en la aplicación de todos los pacientes por haber pulsado guardar no se puede deshacer: ya lo han visto.

### 10. El material lleva firma, y un compañero no lo reescribe

Cualquier profesional de la clínica ve los borradores de los demás —evita escribir dos veces lo mismo— pero solo su autor y el administrador pueden editarlos, retirarlos o archivarlos. En ese caso la respuesta es **403 con explicación**, no 404: dentro de la misma clínica el recurso sí existe, y ocultarlo confundiría más que ayudar. El 404 se reserva para lo de otra clínica.

### 11. Publicar y retirar son el mismo interruptor

El encargo pedía `/publicar` y `/despublicar`. Es una sola operación con dos valores, y separarla duplica la comprobación de permiso en dos sitios que con el tiempo divergen. `PATCH …/publicacion` con `{ publicado: true | false }`.

Al retirar se conserva `publicado_en`: es cuándo estuvo disponible, no un campo de estado. Y al republicar se respeta la fecha original — republicar no convierte material de enero en novedad de agosto.

### 12. Abrir un recurso lo marca como leído, y solo la primera vez

No hay forma de saber si el paciente llegó al final, y pedirle que pulse un botón para confirmarlo solo añade un paso que casi nadie da. Se guarda la **fecha** de la primera lectura, no un booleano: un booleano responde «lo leyó» y una fecha responde además «cuándo», que es la pregunta útil justo después de publicar algo.

### 13. El contenido se pinta como texto, nunca como HTML

Lo escribe una persona en un cuadro de texto de la aplicación profesional. Meterlo con `innerHTML` dejaría que lo escrito allí ejecute algo en la aplicación del paciente. Se parte por párrafos y se pinta como texto.

### 14. La biblioteca no es una sexta pestaña

La barra inferior sigue con cinco, que es el máximo razonable en un móvil. Se llega desde una tarjeta de Inicio, igual que `/progreso` en la Rebanada 23.

---

## Lo que salió al construirlo

**El índice de búsqueda no se dejaba crear.** `functions in index expression must be marked IMMUTABLE`. Ni `unaccent()` ni `array_to_string()` lo están —la primera porque en teoría su diccionario puede cambiar, la segunda porque depende de la función de salida del tipo—. Se resolvió con `alimento_texto_busqueda(nombre, sinonimos)`, que fija el diccionario y sí es constante. Tiene una ventaja añadida: el endpoint de búsqueda usa **la misma función** que el índice, así que no pueden divergir.

**El trigger habría reventado al borrar.** Estaba escrito con `coalesce(new.registro_comida_id, old.registro_comida_id)`. En un trigger de `DELETE` la variable `NEW` no llega a asignarse y leerla lanza un error. Se distingue por `TG_OP`. Verificado después contra la base: insertar, acumular, desactivar y borrar físicamente, los cuatro casos.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| Migraciones 025 y 026 | **026 y 027** — las anteriores las ocupó la R23 |
| `apps/api/src/db/migrations/` y `src/db/seeds/` | `apps/api/migrations/`; el seed va dentro de la migración |
| `carbs_por_100g`, `grasas_por_100g` | `cho_por_100g`, `grasa_por_100g`, como el resto del esquema |
| Tabla `recurso_pac` / `recurso_pac_lectura` | `recurso` / `recurso_lectura` — es material de la clínica, no del paciente |
| `app.authenticate` · `request.user.sub` | `requireAuth` / `requireAuthPaciente` · `request.auth` / `request.authPac` |
| Rutas `/api/profesional/recursos` | `/api/recursos`, como el resto del proyecto |
| `POST /diario/:registroId/items` | `POST /diario/items` con la franja (ver decisión 5) |
| `/publicar` + `/despublicar` + `/archivar` | `PATCH /publicacion` + `DELETE` |
| Catálogo mexicano (jitomate, blanquillos) | Costa Rica, con los mexicanos como sinónimos |
| Sexta pestaña «Biblioteca» en la barra | Tarjeta en Inicio (ver decisión 14) |
| `DiarioComidas.tsx` | El diario vive en `Registros.tsx` como `PanelDiario` |

---

## Contrato de API

| Método | Ruta |
|---|---|
| `GET` | `/api/paciente/alimentos?q=&categoria=` |
| `GET` `PATCH` | `/api/paciente/configuracion` — modo del diario |
| `POST` | `/api/paciente/diario/items` — abre la comida y añade el alimento |
| `GET` | `/api/paciente/diario/:registroId/items` |
| `DELETE` | `/api/paciente/diario/:registroId/items/:itemId` |
| `GET` | `/api/paciente/recursos?categoria=&pagina=` |
| `GET` | `/api/paciente/recursos/:id` — devuelve el contenido y marca leído |
| `GET` `POST` | `/api/recursos` — lado del profesional |
| `GET` `PATCH` `DELETE` | `/api/recursos/:id` |
| `PATCH` | `/api/recursos/:id/publicacion` |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 24.
