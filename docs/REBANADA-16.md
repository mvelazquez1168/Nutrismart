# NutriSmart · Rebanada 16 — Consulta de seguimiento

**Objetivo:** que a partir de la segunda visita el profesional solo tenga que actualizar lo que cambió, y vea de un vistazo la evolución desde la última valoración. Materializa **EVAL-08**.

**Sin migración:** se usa el modelo de las rebanadas 13 a 15.

---

## Decisiones tomadas

### 1. Los deltas dicen la dirección, no si es bueno o malo

Es la decisión de fondo de la rebanada. La especificación pedía marcar cada indicador como `mejora` o `empeora` — bajar de peso como mejora, subir como empeora.

**Bajar dos kilos es un logro en un paciente con obesidad y una señal de alarma en uno desnutrido o con cáncer.** Sin un objetivo de peso registrado, el servidor no tiene con qué distinguirlos, y pintar la flecha de verde afirmaría algo que nadie ha comprobado. La propia especificación lo intuía —«el profesional interpreta el contexto clínico»— y aun así pedía el color.

Se devuelve `direccion: 'sube' | 'baja' | 'igual'`, con la magnitud y el porcentaje. La flecha y el signo son aritmética; la lectura la pone quien atiende. Al pie de la pantalla se dice explícitamente.

Es el mismo criterio de la Rebanada 5 —«el sistema captura y presenta; no interpreta»— y de la 14 con las interacciones. El día que se registre una meta ponderal, «acercándose al objetivo» pasará a ser computable y honesto.

### 2. Las medidas NO se precargan; todo lo demás sí

La especificación pedía prerellenar el formulario de antropometría con los valores de la consulta anterior «como punto de partida». Eso convierte un descuido en un dato falso: un peso que aparece ya escrito y se guarda sin tocar queda registrado como medición de hoy.

La distinción que se aplica:

- **Se mide cada visita** (peso, perímetros, composición) → el campo empieza **vacío**, con el valor anterior y el delta como texto de apoyo justo debajo.
- **Se arrastra entre visitas** (antecedentes, hábitos, prescripción, frecuencia de consumo) → se precarga, y un aviso dice de dónde viene.

Para el caso legítimo de «hoy no se midió nada nuevo» hay un botón explícito, **«Sin cambios: copiar las anteriores»**, con confirmación. Copiar es una decisión, no un descuido.

### 3. El delta va junto al campo, no en una segunda columna

La especificación pedía dos columnas, *anterior* y *hoy*. Con seis campos, duplicar la rejilla ocupa el doble y separa el número que hay que comparar del que se acaba de teclear. El valor anterior y el cambio van como texto de apoyo bajo cada campo: `Anterior: 80.3 kg · −2.1 kg`.

### 4. El modo seguimiento no depende del tipo de la consulta

Se pide siempre la última valoración finalizada. Si la API responde 404, la pantalla se comporta como una consulta inicial sin decir nada. Así el modo no depende de que `tipo` esté bien calculado, y una consulta marcada como seguimiento por error no rompe nada.

### 5. `historial` y `dietetico` se buscan por PACIENTE, no por consulta

La especificación los buscaba con `WHERE consulta_id = <la anterior>`. Ambos son **únicos por paciente** y se actualizan visita a visita: su `consulta_id` apunta a la última que los tocó, así que esa consulta habría devuelto vacío en cuanto una consulta posterior los editara. Se buscan por paciente, y el `consulta_id` se devuelve aparte para saber dónde se tocaron por última vez.

---

## Contrato de API

| Método | Ruta |
|---|---|
| `GET` | `/api/pacientes/:id/consultas/ultima-finalizada` — **404** si es la primera |
| `GET` | `/api/pacientes/:id/consultas/comparativa?consultaActualId=` |

Las rutas estáticas ganan sobre `/consultas/:consultaId` sin importar el orden de registro: Fastify resuelve los segmentos literales antes que los paramétricos.

La comparativa devuelve además los **acuerdos de la consulta anterior** con su estado, que es la otra pregunta que se hace al abrir un seguimiento: qué se pactó y qué se cumplió.

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 16 (CA-16-01 … CA-16-15).
