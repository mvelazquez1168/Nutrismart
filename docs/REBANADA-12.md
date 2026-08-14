# NutriSmart · Rebanada 12 — IA clínica

**Objetivo:** interpretar un estudio de laboratorio y redactar un borrador de nota SOAP con ayuda de un modelo de lenguaje, siempre como **sugerencia revisable**. Materializa **IA-01** e **IA-02**.

**Migración 015.** Se ejecuta fuera de orden a propósito: el hueco quedó reservado cuando esta rebanada se pospuso, y el runner tolera los saltos de numeración. Las migraciones 016–018 ya estaban aplicadas y no se tocan.

---

## Estado de la verificación

**La API se probó sin `ANTHROPIC_API_KEY`.** Todo lo que no llama al modelo está verificado contra el servidor real: aislamiento por clínica, degradación a 503, guardado, listado, edición, revisión y la regla de autoría.

**Lo que llama al modelo no se ha ejecutado nunca.** Sin clave no hay forma de comprobar la calidad del texto, el reparto en secciones sobre una salida real, ni el registro de tokens con cifras verdaderas. Los criterios CA-12-01, 02, 03, 07, 09 y 18 quedan pendientes de la primera ejecución con clave. No usé ninguna credencial de otra procedencia para simularlo.

Para activarlo: `ANTHROPIC_API_KEY` en el `.env` de la raíz. Nada más.

---

## Decisiones tomadas

### 1. El modelo que pedía la especificación está retirado

`claude-3-5-haiku-20241022` se retiró el **19 de febrero de 2026** y devuelve 404. La función habría fallado siempre, con un error que parece de red y manda a depurar el sitio equivocado. Su reemplazo directo es **`claude-haiku-4-5`**, que es lo que se usa.

El modelo que la especificación proponía como salto de calidad —`claude-3-5-sonnet-20241022`— también está retirado; hoy sería `claude-sonnet-5`.

Se respeta la elección de gama: Haiku es barato y basta para redactar sobre datos que se le entregan ya calculados. Quien quiera más capacidad cambia `ANTHROPIC_MODELO` sin tocar código.

### 2. Sin clave, la plataforma arranca igual

La regla de oro dice que **nunca se bloquea el acceso clínico** por el estado del crédito de IA. Arrancar sin clave es el mismo caso: `ANTHROPIC_API_KEY` es opcional, la API levanta, y solo estas rutas responden 503. Comprobado con la IA caída: expediente, agenda y laboratorios siguen respondiendo 200.

El 503 lleva un `tipo` (`sin_configurar`, `limite_de_uso`, `tiempo_agotado`…) para que la interfaz diga qué pasa y qué hacer, sin exponer detalles del proveedor.

### 3. Existe una tabla de consumo, además de las dos que pedía la especificación

`CLAUDE.md` exige registrar **cada llamada de IA** con modelo, tokens y costo. La especificación solo guardaba tokens en `interpretacion_ia` y para el SOAP se conformaba con un `console.log` — pero el borrador SOAP **no se persiste**, así que su gasto habría sido invisible. Un `console.log` no es un registro.

`uso_ia` anota toda llamada, incluidas las **fallidas**: una que agotó el tiempo de espera pudo consumir cuota igual. Registrar el consumo nunca tumba la petición: si esa tabla falla, el profesional sigue viendo su interpretación.

### 4. Un marcador sin rango declarado no se presenta como normal

El sistema real tiene tres estados —`normal`, `alterado`, `sin_referencia`— no los cuatro que asumía la especificación (`normal/bajo/alto/critico`). `sin_referencia` no es un nivel intermedio de alteración: es la **ausencia de criterio**, y al modelo se le dice literalmente eso, con la instrucción de no describirlo nunca como dentro de lo esperado.

Es la misma decisión de la Rebanada 5. Sin ella, un biomarcador que la clínica no ha configurado aparecería en la interpretación como tranquilizadoramente normal.

### 5. Los datos del paciente van delimitados y declarados como datos

El nombre del paciente y las notas del profesional entran en el prompt. Son texto que escribió alguien: sin delimitar, una frase con forma de instrucción dentro de ese texto se leería como parte del encargo. Van en `<datos_paciente>` con la advertencia explícita de que son el contenido de un campo.

El riesgo aquí es bajo —la salida la revisa una persona y no ejecuta nada— pero la mitigación no cuesta nada.

### 6. El borrador SOAP no se guarda solo

La especificación ya lo pedía y conviene subrayar por qué: una nota SOAP en el expediente es un **texto firmado por una persona**. Guardar automáticamente lo que dijo el modelo la convertiría en historia clínica sin que nadie la haya leído. `POST /soap/generar` devuelve el borrador y no toca la base.

`generada_ia` viaja hasta el guardado aunque el profesional reescriba cada palabra: la nota nació de una sugerencia y el expediente debe poder decirlo.

### 7. Editar una nota SOAP exige autoría; la conclusión de la R15 no

Las dos reglas parecen contradictorias y no lo son. En la Rebanada 15 se rechazó filtrar por autoría porque un compañero que cubre una baja tiene que poder completar la valoración. Una nota SOAP es distinta: lleva la firma de quien la escribió, y que otro la reescriba dejaría la firma de uno sobre las palabras de otro.

El equipo **sí** puede leerla y marcarla como revisada. Para aportar su lectura, escribe la suya. La respuesta a un intento de edición ajena es **403 con motivo**, no 404: el profesional ya está viendo la nota, así que ocultarle el porqué no protege nada.

### 8. Quién revisó, no solo que fue revisada

Ambas tablas guardan `revisada_por`. Una interpretación que entra al expediente la avala una persona con nombre. Revisar es idempotente pero **no se vuelve a firmar**: se conserva quien la avaló primero.

### 9. El `max_tokens` de la especificación cortaba el texto

1024 tokens no dan para una interpretación de 600 palabras en español: se cortaría a media frase, justo en «Seguimiento prioritario», que es la sección que más importa. Se usa 4096.

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| Tabla `lab_exam` | **`lab_estudio`** — la FK habría fallado al crear la tabla |
| `estado` almacenado en el resultado | Se **calcula al leer** contra el rango vigente; se reutiliza `listarEstudios` de la R5 en vez de duplicar la resolución de rangos |
| `paciente.apellidos` | No existe; `nombre` es el nombre completo |
| `AbortSignal.timeout(30000)` | La opción `timeout` del SDK (60 s), que además cancela bien el reintento |
| `console.log` como medidor | Tabla `uso_ia` |
| `npm run lint` | No existe; `tsc --noEmit` y build |

---

## Contrato de API

| Método | Ruta |
|---|---|
| `POST` | `/api/labs/:estudioId/interpretar` — **201**; **503** si la IA no está |
| `GET` | `/api/labs/:estudioId/interpretacion` — la más reciente; **404** si no hay |
| `PUT` | `/api/labs/:estudioId/interpretacion/:id/revisar` |
| `POST` | `/api/pacientes/:id/soap/generar` — devuelve borrador, **no persiste** |
| `POST` `GET` | `/api/pacientes/:id/soap` |
| `GET` `PUT` | `/api/pacientes/:id/soap/:soapId` — editar exige autoría (**403**) |
| `PUT` | `/api/pacientes/:id/soap/:soapId/revisar` |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 12 (CA-12-01 … CA-12-18).
