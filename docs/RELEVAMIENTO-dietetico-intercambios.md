# Relevamiento — Dietético / Consumo Usual y las listas de intercambio

Fecha: 2026-10-12
Alcance: **relevamiento, sin cambios.** Nada de esto está implementado todavía.

---

## El hallazgo que cambia el encuadre

El requerimiento dice que los cálculos deben basarse *«exclusivamente en el documento
de base de conocimiento "Listas de Intercambio de Alimentos — NutriSmart" (sistema
ADA + Valance) que reside en la knowledge base de la plataforma»*.

**Ese documento no existe en el proyecto, y la knowledge base tampoco.** Lo verifiqué
en cuatro lugares:

| Dónde busqué | Qué hay |
| --- | --- |
| El repositorio (`docs/`, `datos/`, `*.md`, código) | Ninguna mención a «Valance». Cero coincidencias en todo el proyecto. |
| La tabla `recurso` | Tres filas, y son **material educativo para el paciente**: «Cómo leer una etiqueta nutricional», «Guía de porciones en PDF», «Guía alimentaria de la OMS». No es una base de conocimiento para la IA. |
| La tabla `archivo` y `datos/archivos/` | Cinco adjuntos clínicos de prueba, de 11 a 138 bytes: `Informe glucémico.pdf`, `passwd.pdf`, `labs.csv` ×2, `guia.pdf`. |
| Infraestructura de recuperación | No hay. Ni almacén de vectores, ni embeddings, ni módulo de conocimiento, ni nada que consulte documentos. |

**Dónde vive hoy la tabla ADA:** escrita a mano dentro del prompt, en
`apps/api/src/routes/registroDietetico.ts` (la constante `SISTEMA_ADA`), con **once
grupos**: leche descremada/semi/entera, vegetales, frutas, azúcares, cereales, carnes
magras/semimagras/alta grasa, y grasas.

**Valance no está en ninguna parte.**

### Por qué esto bloquea y no es un detalle

Dos razones, y la segunda es la que importa:

1. «Basarse exclusivamente en el documento» no se puede implementar sin el documento.
2. **No puedo inventar los valores.** Son datos de referencia clínica: un gramo de
   más en un grupo de intercambio se multiplica por porciones, se suma al día, y
   termina en una prescripción para una persona. Completar «ADA + Valance» de memoria
   para que el flujo compile sería la peor forma posible de entregar esto.

Lo que hace falta es el documento. Con él, lo de abajo es trabajo mecánico.

---

## Cómo está hoy el módulo, de punta a punta

### La captura: texto libre por tiempo de comida, no alimento + cantidad

`registro_dietetico` guarda **una fila por (consulta, tipo)** —`recordatorio_24h` y
`consumo_usual` comparten tabla y forma— con un JSONB `filas` de exactamente **seis
tiempos fijos**: desayuno, merienda mañana, almuerzo, merienda tarde, cena, colación
nocturna.

Cada tiempo tiene:

```
tiempo_comida, hora, alimentos_consumidos (texto libre),
ai_kcal, ai_cho_g, ai_prot_g, ai_grasas_g, ai_calculado_en,
kcal_manual
```

O sea: **no hay entidad «alimento registrado»**. Hay un párrafo de texto por tiempo de
comida. El requerimiento habla de *«cuando el profesional registra un alimento y una
cantidad»*, y hoy eso no es una fila que se pueda identificar — es una parte de una
cadena.

### La invocación de la IA: una llamada por tiempo de comida

`POST /api/pacientes/:id/consultas/:consultaId/registro-dietetico/:tipo/analizar-ia`
con `{ tiempo_comida }`.

El prompt le pide al modelo que haga **todo**: identificar alimentos, asignarlos a un
grupo, estimar intercambios, multiplicar, y **sumar**. Devuelve un único total del
tiempo de comida.

Hay caché: si `ai_calculado_en` está puesto y el texto no cambió, no se vuelve a
llamar. El upsert limpia los `ai_*` cuando el texto cambia, así que un
`ai_calculado_en` presente significa «vigente».

### La estructura de la respuesta: cuatro números y nada más

```json
{ "kcal": 0.0, "cho_g": 0.0, "prot_g": 0.0, "grasas_g": 0.0 }
```

**No trae el grupo de intercambio, ni las porciones equivalentes, ni el desglose por
alimento, ni si encontró cada alimento.** Y `parsearJson` convierte cualquier valor no
numérico en `0`, así que un alimento que el modelo no supo clasificar **llega como
cero y se ve igual que un alimento sin calorías**.

Ahí está el segundo hallazgo: hoy no hay forma de distinguir «no encontrado» de
«encontrado y vale cero». El requerimiento pide exactamente esa distinción.

### La persistencia: sólo kcal se puede corregir

`kcal_manual` vive **aparte** de `ai_kcal` en vez de pisarlo, y el diseño es bueno:
vaciar el campo devuelve el número de la IA, que sigue intacto, y se puede ver cuánto
se corrigió. La cuenta efectiva es `kcal_manual ?? ai_kcal`.

**CHO, proteínas y grasas no tienen equivalente.** Son de sólo lectura. El comentario
de la función de totales lo dice sin rodeos: *«una fila con solo kcal a mano suma
calorías y no suma gramos»*.

### Los totales: ya son en vivo, y sólo para kcal

Esto sí está, y está bien hecho. `TablaDietetica.tsx` tiene `totalesLocales`, que
recalcula en el cliente a partir del estado, con el comentario *«el pie tiene que
seguir al teclado»*. No depende del guardado.

El servidor además calcula y persiste los totales en `registro_dietetico`
(`total_kcal`, `total_cho_g`, …) para que otras pantallas no tengan que sumar.

Lo que falta: que los macros honren correcciones manuales, porque hoy no existen.

---

## La distancia entre lo que hay y lo que se pide

| Lo pedido | Hoy | Tamaño |
| --- | --- | --- |
| Basarse en el documento de la knowledge base | Tabla ADA escrita en el prompt; sin KB; sin Valance | **bloqueado: falta el documento** |
| Registrar alimento + cantidad | Texto libre por tiempo de comida | cambio de modelo de datos y de la tabla de la UI |
| Identificar grupo, calcular porciones, aplicar valores del grupo | El modelo hace todo y devuelve el total | cambio del contrato de la IA |
| Notificación visible si no se encuentra | No existe; un no-encontrado llega como `0` | cambio del contrato + UI |
| Los cuatro valores editables | Sólo kcal | aditivo y de bajo riesgo |
| Panel de totales en vivo, siempre visible | Existe y funciona, pero sólo kcal honra corrección | pequeño, depende del anterior |

---

## La decisión de arquitectura que el propio requerimiento ya toma

Vale hacerla explícita porque es la que da sentido a todo lo demás.

El requerimiento dice: *«identifica el grupo de intercambio correspondiente, calcula
las porciones equivalentes y aplica los valores nutricionales del grupo (CHO ×
porciones, …)»*. Eso describe **la IA clasifica, el código calcula**: el modelo dice
«esto es 2 intercambios de cereales», y la multiplicación la hace el servidor contra
la tabla de grupos.

Es lo contrario de hoy, donde el modelo también hace la aritmética y la suma. Y es
mejor por tres motivos, más allá de la precisión:

- **«Basarse exclusivamente en el documento» pasa a ser verificable.** Si la
  multiplicación la hace el código contra una tabla, el número no puede venir de otro
  lado. Mientras el modelo sume, «exclusivamente» es una instrucción en un prompt.
- **El no-encontrado deja de ser un cero.** Si el modelo sólo clasifica, «no supe a
  qué grupo va» es una respuesta que se puede devolver y mostrar.
- Encaja con la regla de oro del proyecto: *la IA asiste, el profesional decide*.

No la tomé yo: está en el requerimiento. La señalo porque cambia qué parte del trabajo
es de prompt y qué parte es de código, y porque exige que la tabla de grupos sea
**datos** y no una cadena.

---

## Qué hace falta para desbloquear

**El documento «Listas de Intercambio de Alimentos — NutriSmart».** Con él:

1. Se carga como tabla de grupos de intercambio (`grupo_intercambio`: nombre, CHO,
   proteína, grasa, kcal por intercambio, y la equivalencia de porción por alimento).
2. El prompt pasa a clasificar, no a calcular.
3. El resto es mecánico y está descrito arriba.

Sirve en cualquier formato legible —el PDF, un CSV, o pegado como texto—. Lo que no
puedo es reconstruirlo: de los dos sistemas que nombra, ADA está en el código con once
grupos y **Valance no aparece en ninguna parte del proyecto**.


---
---

# Parte 2 — ¿La Biblioteca es la fuente de conocimiento de la IA?

Fecha: 2026-10-12

## La respuesta corta

**No, y no existe ninguna otra.** La IA de este proyecto no consulta ninguna fuente de
conocimiento: todo lo que sabe en cada llamada es la cadena de texto que el código le
arma.

## Cómo lo verifiqué

### El contrato del cliente de IA no admite una fuente

`apps/api/src/ia/cliente.ts` expone **una sola** función de salida:

```ts
export async function llamarClaude(prompt: string, ctx: Contexto): Promise<ResultadoIA>
```

Y lo que manda es exactamente eso:

```ts
messages: [{ role: 'user', content: prompt }]
```

Un `string`. Sin prompt de sistema, sin documentos adjuntos, sin recuperación. Lo
único que toca de la base de datos es un `insert into uso_ia` para el medidor de
consumo — **escribe, no lee**.

O sea que la pregunta «¿qué fuente consulta la IA?» tiene una respuesta estructural:
ninguna, porque el punto de salida no tiene por dónde recibirla.

### Los tres sitios de llamada, y ninguno lee conocimiento

| Función | Archivo | De dónde sale su conocimiento |
| --- | --- | --- |
| `interpretacion_labs` | `routes/ia.ts:154` | `promptInterpretacionLabs(datos)` — datos del paciente |
| `nota_soap` | `routes/ia.ts:385` | `promptGenerarSOAP(datos)` — datos de la consulta |
| `analisis_dietetico` | `routes/registroDietetico.ts:483` | `construirPrompt()` → la constante `SISTEMA_ADA`, **escrita a mano en el código** |

`apps/api/src/ia/prompts.ts` no tiene una sola consulta a la base: sus dos funciones
exportadas reciben los datos por parámetro y devuelven una cadena.

### La Biblioteca es otra cosa, y lo dice su propio encabezado

`apps/api/src/routes/recursos.ts` abre con:

> *«Biblioteca de recursos — PAC-08. El profesional escribe material educativo y el
> paciente lo lee desde su aplicación.»*

La tabla `recurso` tiene `publicado`, `publicado_en`, `imagen_portada_url`,
`categoria` entre nutrición/ejercicio/hábitos/recetas, y una tabla hermana
`recurso_lectura` para registrar quién lo leyó. Es **contenido publicado para
pacientes**, con autoría y firma.

`routes/ia.ts` menciona la palabra «recurso» **una vez**, y es un texto de error
genérico —`'No se encontró el recurso'`—, no una lectura de la tabla.

### Y no hay ninguna tabla de conocimiento en el esquema

Las 55 tablas, sin filtrar: `alerta_config, alerta_rpm, alimento_catalogo, archivo,
biomarcador, biomarcador_rango, brand_config, cita, clinica, clinical_note,
clinical_snapshot, conclusion_valoracion, conexion_wearable, configuracion_paciente,
consulta, conversacion, cumplimiento_acuerdo, evaluacion_dietetica, farmacologia,
historial_clinico, interpretacion_ia, invitacion_paciente, lab_estudio, lab_resultado,
medicion_antropometrica, mensaje, metrica_catalogo, nota_soap, notificacion, paciente,
paciente_alergia, paciente_antecedente, paciente_diagnostico,
paciente_sociodemografico, pdf_export, plan_alimentario, plan_comida, profesional,
recordatorio_cita, recurso, recurso_lectura, registro_bienestar, registro_comida,
registro_comida_item, registro_dietetico, registro_medida_corporal, registro_metrica,
regla_notificacion, schema_migrations, snapshot_metrica, tarea_paciente, uso_ia,
wearable_oauth_estado`.

Ni almacén de vectores, ni tabla de fragmentos, ni índice de documentos.
`interpretacion_ia` guarda **salidas** de IA, no entradas.

---

## Dónde debe residir el documento

Y acá está el hallazgo que cambia la recomendación: **el proyecto ya resolvió este
mismo problema una vez, para el paciente.**

### El precedente: migración 026

`apps/api/migrations/026_alimentos.sql` abre diciendo:

> *«PAC-07: contador de porciones. El diario admite una frase por comida ("arroz con
> pollo y ensalada") y, opcionalmente, las calorías a ojo. Esto añade el modo
> DETALLADO: alimento por alimento, con cantidad, y **las kcal salen de una tabla en
> vez de una estimación**.»*

Esa frase es, palabra por palabra, lo que ahora se pide para el módulo del
profesional. Y lo que se construyó entonces fue:

| Pieza | Qué es | Dónde |
| --- | --- | --- |
| `alimento_catalogo` | tabla de referencia, 46 alimentos, **sembrada en la migración**. `clinica_id` nulo = fila global; con valor = ajuste de una clínica. Índices únicos parciales para las dos cosas. | migración 026 |
| `registro_comida_item` | **alimento por alimento, con cantidad**: `nombre_alimento`, `cantidad_g`, `kcal`, `proteina_g`, `cho_g`, `grasa_g`, y `alimento_id` **nullable** | migración 026 |
| `routes/alimentos.ts` | la búsqueda, con `unaccent` + `pg_trgm` para que «brocoli» encuentre «Brócoli» | — |

Fijate en dos detalles de `registro_comida_item`, porque son exactamente los dos que
el requerimiento nuevo pide y que el módulo del profesional no tiene:

- **`alimento_id` es nullable.** Un alimento que no está en el catálogo **se puede
  representar**: queda con nombre y cantidad y sin referencia. El «no encontrado» ya
  está modelado del lado del paciente.
- **Los cuatro valores son nullable e independientes.** Se pueden escribir a mano, los
  cuatro, no sólo las kcal.

O sea: del lado del paciente, las kcal salen de una tabla y el no-encontrado es un
estado legítimo. Del lado del **profesional**, que es el que toma decisiones clínicas,
sigue saliendo de una estimación de IA sobre un párrafo de texto libre, y sólo las
kcal se pueden corregir.

### La recomendación

El documento **no va a `recurso` ni a `archivo`**, y vale decir por qué:

- **`recurso`** es contenido publicado para pacientes, con autoría, categoría y
  registro de lectura. Meter datos de referencia ahí los haría visibles al paciente,
  obligaría a duplicarlos por clínica, y **seguiría sin que la IA los lea** — porque
  nada los lee.
- **`archivo`** guarda adjuntos binarios. Un PDF ahí necesitaría extracción de texto,
  fragmentación y recuperación: eso es construir una knowledge base, no cargar un
  documento. Y para un cálculo clínico es el peor camino, porque el número dependería
  de que un parser haya leído bien una tabla de un PDF.

**Va como tabla de referencia sembrada en una migración, siguiendo el patrón de la
026.** Concretamente:

1. **`apps/api/migrations/048_listas_intercambio.sql`** (la siguiente libre: la última
   es `047_ia.sql`). Crea `grupo_intercambio` —nombre del grupo, CHO g, proteína g,
   grasa g y kcal **por intercambio**— y `equivalencia_intercambio`, que es lo que
   traduce «una taza de arroz» a «2 intercambios de cereales»: alimento, unidad,
   cantidad, y cuántos intercambios del grupo equivale.
   Con `clinica_id` nullable, igual que `alimento_catalogo`: el documento entra como
   filas globales y una clínica puede ajustar sin tocar las de todos.
2. **El `insert` del sembrado va en la misma migración**, idempotente, como el de la
   026. Así el documento *es* el contenido de la migración y queda versionado con el
   código: cualquiera puede ver en el historial qué valores cambiaron y cuándo. Para
   datos de referencia clínica eso no es prolijidad, es trazabilidad.
3. **`construirPrompt` deja de llevar la tabla.** El prompt pasa a clasificar
   —«¿a qué grupo va este alimento y cuántos intercambios son?»— y la multiplicación
   la hace el servidor leyendo `grupo_intercambio`. Es lo que vuelve verificable el
   «basarse exclusivamente en el documento»: si el código multiplica contra la tabla,
   el número no puede venir de otro lado.
4. **La constante `SISTEMA_ADA` se borra del código.** Mientras exista, hay dos
   fuentes de verdad para los mismos once grupos y nada impide que discrepen.

### Qué hace falta para cargarlo

Sólo el contenido del documento. Con los valores por grupo —CHO, proteína, grasa, kcal
por intercambio— y las equivalencias de porción, la migración se escribe sola.

Sirve en cualquier formato legible: el PDF, un CSV, una tabla pegada como texto. Lo que
no se puede es reconstruirlo: **«Valance» no aparece en ningún archivo del proyecto**,
y de ADA hay once grupos escritos en un prompt, que no es lo mismo que un documento
revisado.
