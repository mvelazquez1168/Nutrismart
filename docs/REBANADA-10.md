# NutriSmart · Rebanada 10 — Exportación del expediente a PDF

**Objetivo:** que el profesional entregue el expediente en un documento con la marca de la clínica, eligiendo qué secciones incluye y añadiendo sus recomendaciones. Materializa **CLI-05**.

**Depende de:** Rebanada 2 (pacientes), 5 (laboratorios), 6 (marca), 7 (sociodemografía) y 9 (plan alimentario). Es la primera que **consume** casi todo lo anterior en vez de añadir un dominio nuevo.

---

## Alcance

**Incluye:**
- Migración `012`: `pdf_export`, historial de lo que salió de la clínica.
- Generación con Chromium a partir de HTML, con reserva a HTML si no está disponible.
- Cuatro secciones opcionales y un campo de recomendaciones.
- Portada con el logo y el color de la clínica.
- `POST /api/pacientes/:id/pdf` y `GET /api/pacientes/:id/pdf/historial`.

**NO incluye:** envío por correo al paciente (épica **COM**; las columnas `enviado_paciente` y `enviado_en` ya existen para no migrar la tabla ese día), plantillas alternativas, firma digital, y guardar el binario generado.

---

## Decisiones tomadas

1. **Se genera HTML y lo imprime Chromium.** La alternativa —componer el PDF con una librería de dibujo— obliga a describir la portada en coordenadas. El documento tiene que llevar la marca de la clínica y una rejilla de 7×6; eso en CSS son treinta líneas y en un DSL de posiciones, un proyecto.

2. **Puppeteer es una dependencia pesada y aun así entra.** Arrastra su propio Chromium. La justificación es que CLI-05 pide exportación de grado profesional y no hay forma de renderizar CSS sin un motor. Queda acotado: es la única dependencia pesada del proyecto y solo la usa este módulo.

3. **El navegador se reutiliza entre exportaciones.** Arrancar Chromium cuesta cerca de un segundo; hacerlo por petición convertiría una acción interactiva en una espera. Se cierra al apagar el proceso, con el mismo manejador que cierra el pool de la base.

4. **Si Chromium falla, se devuelve el HTML.** Un documento clínico no debe quedar retenido por un problema de infraestructura: el profesional lo imprime a PDF desde el navegador y el expediente sale igual. La respuesta lo declara en la cabecera `X-Formato-Exportacion` y la interfaz lo dice en pantalla, en vez de entregar un archivo que el visor no abre.

5. **El logo viaja incrustado como `data:` URI.** Chromium renderiza con `setContent`, fuera de cualquier origen: una ruta como `/api/brand/logo` no resuelve contra nada y, aunque resolviera, la petición saldría sin `Authorization`. El resultado sería un hueco silencioso justo en la cabecera.

6. **Los estados clínicos NO siguen la marca.** El color de cabecera y el de los títulos son los de la clínica; «alterado» es rojo en todas. Un valor fuera de rango tiene que verse igual en pantalla, en papel y en cualquier instalación.

7. **Lo que no se pide, no se consulta.** Si la sociodemografía no va en el documento, tampoco sale de la base. Y el consentimiento se comprueba en la consulta, no en la plantilla: la promesa hecha al paciente no puede depender de un `if` en la capa de presentación.

8. **No se guarda el binario.** El PDF se regenera a partir del expediente; conservar cada copia multiplicaría el almacén sin añadir nada que no esté ya en la base. Lo que sí queda es la traza: qué secciones, con qué recomendaciones y firmado por quién.

9. **Las recomendaciones se guardan con la exportación, no en el expediente.** Es lo que se dijo en *ese* documento. Editarlas después falsearía lo que se entregó.

10. **Solo el plan ACTIVO.** Un borrador no se ha prescrito y un archivado ya no rige; exportar cualquiera de los dos como «el plan» mentiría.

11. **Se reutiliza `listarEstudios` de la Rebanada 5.** Ya resuelve el rango por sexo, el estado y la tendencia. Reimplementar esa lógica aquí produciría un documento que discrepa de la pantalla.

---

## Ajustes contra el esquema real

| Asumido por la especificación | Real |
|---|---|
| `paciente.cedula` | `documento_tipo` + `documento_numero` |
| `paciente.alergias` (columna) | Tabla `paciente_alergia` |
| `clinica.nombre` | `clinica.nombre_comercial` |
| `brand_config.logo_url` | `logo_ruta` + `logo_mime`, y hay que leer del almacén |
| Tabla `lab_exam` con `nombre` y `archivo_url` | `lab_estudio`; se usa el repositorio de R5 |
| `resolverAlcance(request, pacienteId)` | `resolverAlcance(tenantId, sub, roles)` |
| `db.query` | `pool` de `db.ts` |
| `profesional_id` con consulta propia por `keycloak_user_id` | `alcance.profesionalId` |
| Respuestas y cuerpos en `snake_case` | El resto de la API es `camelCase` |

Además: la sección de perfil estaba condicionada a que el paciente tuviera alergias, así que un paciente sin ninguna perdía también el teléfono y el documento; el `Content-Disposition` se construía interpolando el nombre sin sanear —una vía de inyección de cabeceras—; y la consulta de sociodemografía no filtraba por clínica.

---

## Contrato de API

### `POST /api/pacientes/:id/pdf`
```json
{ "secciones": ["perfil", "plan", "laboratorios", "sociodemografico"],
  "notasProfesional": "Reducir sodio y revisar adherencia en dos semanas." }
```
Devuelve el documento como descarga. **400** sin secciones válidas o con recomendaciones de más de 3000 caracteres; **404** si el paciente no es visible.

Una sección desconocida se **descarta** en vez de dar error: el juego va a crecer y un cliente algo desactualizado debe seguir exportando lo que sí entiende.

Cabeceras: `Content-Disposition` saneado, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` y `X-Formato-Exportacion: pdf | html`.

### `GET /api/pacientes/:id/pdf/historial`
Las 20 últimas exportaciones con sus secciones, tamaño, recomendaciones y quién las firmó. La visibilidad se comprueba sobre el paciente: quien no puede verlo tampoco puede saber cuántas veces se exportó su expediente.

---

## Frontend

- **Botón «Exportar PDF»** en la cabecera de la ficha, junto a Editar.
- **Modal** sobre el componente accesible que ya existe —Escape, foco y bloqueo de scroll—, no un overlay propio.
- **La disponibilidad de cada sección se consulta al abrir**, no se supone: marcar «Plan de alimentación» para un paciente que no tiene ninguno produciría un documento con una sección ausente y sin explicación. Las que no aplican salen deshabilitadas y con el motivo.
- El plan activo entra **marcado por defecto**: es lo que el paciente se lleva a casa.
- Si el servidor devolvió HTML, el modal lo dice en lugar de cerrarse como si nada.

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 10 (CA-10-01 … CA-10-08).
