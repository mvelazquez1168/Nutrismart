# NutriSmart · Rebanada 13 — Valoración ABCD: contenedor, antropometría y bioquímica

**Objetivo:** abrir el proceso de valoración nutricional del paciente y construir sus dos primeras secciones. Materializa **EVAL-00** (contenedor), **EVAL-01** (antropometría) y **EVAL-02** (bioquímica integrada).

**Depende de:** Rebanada 2 (pacientes) y **Rebanada 5** (laboratorios), cuya lectura se reutiliza entera.

---

## Alcance

**Incluye:**
- Migración `016`: `consulta` y `medicion_antropometrica`.
- API de consultas con progreso por sección y cierre.
- API de antropometría con índices derivados.
- `GET /labs/nutricional`: relectura de los laboratorios agrupada para valorar.
- Pantalla de valoración con las cinco pestañas del ABCD; dos construidas.

**NO incluye:** valoración clínica y dietética, conclusiones y diagnóstico nutricional — llegan en las rebanadas siguientes. Sus pestañas ya existen, declaradas y vacías.

**Nota de numeración:** se salta la migración `015`, reservada para la Rebanada 12, que aún no se ha ejecutado. El runner ordena por nombre de archivo y tolera el hueco, así que R12 podrá entrar después sin renumerar nada.

---

## Decisiones tomadas

1. **IMC e ICC son columnas GENERADAS en la base**, no valores que envíe el cliente ni que calcule la API. Un índice que llegue desde fuera puede no corresponder con el peso y la talla de su propia fila, y entonces el expediente contiene dos verdades sobre el mismo paciente. La interfaz los calcula también, pero solo para mostrarlos mientras se teclea: la fuente es la base.

2. **El ordinal de la consulta se calcula dentro del propio `INSERT`.** Con un `select count(*)` previo, dos consultas creadas a la vez obtendrían el mismo número y la restricción única lo rechazaría con un error incomprensible. La subconsulta va en la misma sentencia.

3. **Guardar la antropometría ES completar su sección.** Obligar a marcarla aparte solo produce valoraciones que parecen a medias cuando no lo están. La bioquímica sí se marca a mano: revisarla es un acto del profesional, no una consecuencia de que existan laboratorios.

4. **Una medición por consulta.** La segunda sería una corrección, y para eso se edita la que hay: un `ON CONFLICT` sobre `consulta_id` reemplaza. Sin eso, corregir el peso dejaría dos mediciones del mismo día compitiendo en el histórico.

5. **No se precargan los valores de la consulta anterior.** Aparecerían como si se hubieran medido hoy, y bastaría pulsar guardar para falsearlos. El histórico está en la gráfica, que es donde compararlos tiene sentido.

6. **Una consulta finalizada no se edita.** Ni sus secciones ni sus mediciones. Es el registro de lo que se valoró; si volviera a ser editable, dejaría de probar nada.

7. **Sin antropometría y sin conclusión no se finaliza.** La comprobación está en el servidor además de en el botón: el botón decide qué se ve, no qué se puede.

8. **La bioquímica no captura nada.** Relee los estudios de la Rebanada 5 reutilizando `listarEstudios`, que ya resuelve el rango por clínica y sexo, el estado y la tendencia. Reimplementarlo aquí produciría una pantalla que discrepa de la de Laboratorios sobre el mismo valor.

9. **Los grupos salen del catálogo (`biomarcador.grupo`), no de listas de nombres en el código.** El catálogo ya trae perfil lipídico, glucémico, hematología, vitaminas… y un biomarcador nuevo queda clasificado sin tocar nada. Con listas escritas a mano, el marcador que no figure cae en un limbo silencioso.

10. **`bajo` y `alto` en vez del `alterado` de la Rebanada 5.** Para valorar hace falta saber hacia dónde se sale del rango: una ferritina baja y una alta no cuentan la misma historia. La lectura fina se deriva del valor y el rango que ya devuelve el repositorio.

11. **No hay nivel `critico`.** El valor de pánico depende de umbrales que este proyecto sitúa en el motor de monitoreo (RPM). Inventarlo aquí sería una alarma sin criterio detrás.

12. **Solo el valor más reciente de cada biomarcador.** Un paciente con tres hemogramas en el trimestre tendría tres hemoglobinas en la tabla, y quien valora acabaría comparándolas entre sí en lugar de leer el estado actual. El histórico ya está en su pestaña.

13. **Las fórmulas de pliegues devuelven `null` sin edad y sexo.** Los coeficientes de Durnin-Womersley y Jackson-Pollock dependen de ambos; completarlos con valores por defecto daría un porcentaje con apariencia de dato. Es el mismo criterio que el `sin_referencia` de los laboratorios.

14. **La estimación no pisa al profesional.** El porcentaje calculado solo se envía si él no escribió uno propio: si el aparato de bioimpedancia o su criterio dicen otra cosa, manda eso.

15. **Gráfica en SVG, sin librería.** Son dos series sobre pocos puntos; añadir una dependencia de gráficas no se sostiene, y así los colores salen de los tokens. Es un área **apilada** cuyo borde superior ES el peso total: dibujar además una línea de peso sería el mismo dato dos veces.

---

## Ajustes contra el código real

| Asumido por la especificación | Real |
|---|---|
| Última migración `015` | Va la `014`; la `015` queda reservada para R12 |
| `resolverAlcance(request, pacienteId)` | `resolverAlcance(tenantId, sub, roles)` |
| `profesional_id` por consulta a `keycloak_user_id` | `alcance.profesionalId` |
| Tablas `lab_exam` / `lab_resultado` con `rango_min` y `rango_max` | `lab_estudio`; los rangos viven en `biomarcador_rango`, por clínica y sexo |
| 4 grupos con listas de nombres a fuego | `biomarcador.grupo`, ya sembrado con 7 grupos |
| Estado `critico` | No existe base para emitirlo |
| `utils/composicion.ts` | El proyecto usa `lib/` |
| `recharts` «ya instalado» | No hay ninguna librería de gráficas |
| `npm run lint` | No existe ese script; se usan `tsc --noEmit` y el build |
| IMC/ICC calculados en la API | Columnas generadas en la base |

---

## Contrato de API

| Método | Ruta | Nota |
|---|---|---|
| `POST` | `/api/pacientes/:id/consultas` | **201**; ordinal y tipo se calculan solos |
| `GET` | `/api/pacientes/:id/consultas` | De la más reciente hacia atrás |
| `GET` | `/api/pacientes/:id/consultas/:consultaId` | |
| `PUT` | `…/consultas/:consultaId/seccion` | **409** si está finalizada |
| `PUT` | `…/consultas/:consultaId/finalizar` | **409** con `faltan` si quedan secciones |
| `POST` | `/api/pacientes/:id/antropometria` | Reemplaza la medición de esa consulta |
| `GET` | `/api/pacientes/:id/antropometria` | Histórico, `limite` máx. 50 |
| `GET` | `…/antropometria/ultima` · `…/antropometria/consulta/:consultaId` | **404** si no hay |
| `GET` | `/api/pacientes/:id/labs/nutricional?dias=` | Agrupado por catálogo |

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 13 (CA-13-01 … CA-13-20).
