# NutriSmart · Rebanada 14 — Valoración ABCD: historial clínico y evaluación dietética

**Objetivo:** completar las dos secciones que faltaban del ABCD. Materializa **EVAL-03** (clínico, farmacología e interacciones) y **EVAL-04** (dietético).

**Depende de:** Rebanada 13, que trajo el contenedor de la consulta y sus dos primeras secciones.

---

## Alcance

**Incluye:**
- Migración `017`: `historial_clinico`, `farmacologia` y `evaluacion_dietetica`.
- API de historial (UPSERT por paciente), medicación con baja lógica e interacciones.
- API de evaluación dietética (UPSERT por paciente).
- Pestañas Clínico y Dietético de la valoración, con sus formularios.

**NO incluye:** conclusiones y diagnóstico nutricional, y la calculadora de requerimientos — llegan en la rebanada siguiente. La comparación de los macros contra las necesidades del paciente queda declarada y pendiente en el resumen dietético.

---

## Decisiones tomadas

1. **Faltaban los índices únicos que el UPSERT necesita.** La especificación pedía `ON CONFLICT (clinica_id, paciente_id)` en dos tablas cuya migración no creaba esa restricción. Postgres exige un índice único que coincida con la especificación del conflicto; sin él, cada guardado habría fallado con un error que no dice nada al profesional. Se añaden como restricciones con nombre.

2. **Historial y dietético son UNO por paciente**, no uno por consulta. «El padre tiene diabetes» no deja de ser cierto en la visita siguiente, y obligar a reescribirlo cada vez garantiza que se copie mal. `consulta_id` guarda en qué consulta se tocó por última vez. Es lo contrario de la antropometría, donde cada peso pertenece a un día concreto.

3. **El FAF lo calcula el servidor** a partir del tipo de actividad elegido. Si lo enviara el cliente, podría no corresponder con la etiqueta que el profesional ve en pantalla. Se guarda ya calculado para que el histórico conserve el valor que se usó aunque la tabla de referencia cambie.

4. **Suspender un medicamento es baja lógica.** Un fármaco retirado explica hallazgos de laboratorio pasados; borrarlo dejaría el expediente sin la causa. Por eso el botón dice «Suspender».

5. **Las interacciones son una lista curada, no un comprobador.** Es la decisión con más peso clínico de la rebanada, y está desarrollada abajo.

6. **Los macros no se derivan del recordatorio.** Hacerlo bien exige una tabla de composición de alimentos, que es otra épica. Los declara el profesional y la interfaz lo dice. Lo único que sí se calcula es la coherencia interna: si los gramos declarados suman unas kilocalorías que se apartan más de un 10 % de las declaradas, se avisa — suele ser un valor mal tecleado.

7. **La evaluación dietética se guarda en UNA petición.** Sus tres sub-secciones comparten estado; guardarlas por separado dejaría media evaluación si la red falla a mitad.

8. **Los grupos de alimentos NO usan los tokens de estado clínico.** «Carnes procesadas» no es una alerta médica del paciente, y pintarla con el mismo rojo que un valor de laboratorio fuera de rango mezclaría dos lenguajes. Van con la paleta de datos.

9. **El tamizaje de relación con la comida se presenta como lo que es.** Cinco preguntas con escala, con una nota al pie: no es un instrumento validado, y si algo preocupa la respuesta es derivar a salud mental, no ajustar el plan.

---

## Sobre las interacciones fármaco–nutriente

La especificación pedía «una tabla de interacciones» y un panel que dijera *«No significant drug-nutrient interactions detected»* cuando no encontrara ninguna.

Eso es lo que no se implementó, y conviene decir por qué. La lista cubre ocho principios activos. Un comprobador que conoce ocho fármacos y responde «sin interacciones» ante los otros mil **convierte su propia ignorancia en una afirmación tranquilizadora**. El riesgo no es que falle: es que su fallo se lea como una comprobación hecha.

Lo que se construyó:

- La respuesta incluye **`noReconocidos`**: los fármacos del paciente que la lista no cubre.
- Cuando no hay coincidencias, el panel **no** dice «sin interacciones». Dice que ninguno de los medicamentos registrados figura entre los N principios activos que cubre la revisión.
- Los no reconocidos se listan con una frase explícita: *no significa que no interactúen, significa que esta lista no los contempla*.
- El pie declara que es una ayuda de memoria y **no** un comprobador.

Es el mismo criterio que el proyecto aplica a la IA —asiste, el profesional decide— aunque aquí no haya modelo de por medio. Ampliar la lista es añadir entradas; sustituirla por una base farmacológica de verdad es otra épica.

La severidad se ordena de mayor a menor y va **escrita** además de en color: lo que exige coordinar con quien controla la anticoagulación no puede quedar debajo de una nota informativa.

---

## Ajustes contra el código real

| Asumido por la especificación | Real |
|---|---|
| `ON CONFLICT` sin índice único que lo respalde | Se añaden `historial_por_paciente` y `dietetico_por_paciente` |
| `resolverAlcance(request, pacienteId)` | `resolverAlcance(tenantId, sub, roles)` |
| `profesional_id` por consulta a `keycloak_user_id` | `alcance.profesionalId` |
| `snake_case` en cuerpos y respuestas | `camelCase`, como el resto de la API |
| Donut con Recharts | No hay librería de gráficas; SVG a mano |
| `npm run lint` | No existe; se usan `tsc --noEmit` y el build |
| Colores Tailwind (`amber-50`, `red-50`…) | Tokens del design system |

---

## Contrato de API

| Método | Ruta | Nota |
|---|---|---|
| `GET` `PUT` | `/api/pacientes/:id/historial` | UPSERT; **404** si aún no existe |
| `GET` `POST` | `/api/pacientes/:id/farmacologia` | |
| `PUT` `DELETE` | `/api/pacientes/:id/farmacologia/:medId` | El DELETE suspende |
| `GET` | `/api/pacientes/:id/farmacologia/interacciones` | Devuelve también `noReconocidos` y `cobertura` |
| `GET` `PUT` | `/api/pacientes/:id/dietetico` | UPSERT |

Guardar cualquiera de los dos con `consultaId` marca su sección como completa, igual que la antropometría.

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 14 (CA-14-01 … CA-14-17).
