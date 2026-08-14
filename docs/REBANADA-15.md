# NutriSmart · Rebanada 15 — Conclusiones, calculadora y plan prescrito

**Objetivo:** cerrar la valoración ABCD con el diagnóstico nutricional, la prescripción y los acuerdos, apoyados en una calculadora de requerimientos. Materializa **EVAL-05**, **EVAL-06** y **EVAL-07**.

**Depende de:** Rebanadas 13 y 14 (el contenedor y las cuatro secciones previas) y de la 9, cuyo plan alimentario se muestra aquí en solo lectura.

Con esta rebanada, **las cinco secciones del ABCD quedan construidas**.

---

## Decisiones tomadas

1. **Los gramos de cada macro los deriva el servidor.** Aceptarlos del cliente permitiría guardar unos gramos que no corresponden con el reparto declarado en su propia fila, y la prescripción diría dos cosas a la vez. Es el mismo criterio que el IMC de la Rebanada 13.

2. **Los porcentajes deben sumar 100, y lo comprueba también la base.** Un reparto 20/50/40 suma 110: los gramos derivados serían coherentes entre sí y aun así describirían una dieta que no existe. Se permite que falten los tres mientras la prescripción está a medio escribir, pero no dos de tres.

3. **La conclusión es DE LA CONSULTA, no del paciente.** Al revés que el historial y el dietético, que son uno por paciente y se actualizan. El juicio de hoy no sustituye al de hace tres meses: ambos quedan, y esa es la historia clínica.

4. **La calculadora vive entera en el cliente.** Son fórmulas cerradas sobre datos que la pantalla ya tiene; un viaje al servidor no añadiría nada y le quitaría al profesional el resultado inmediato mientras ajusta un porcentaje.

5. **Sin sexo biológico no hay estimación de metabolismo basal.** La diferencia entre las constantes de hombre y mujer en Mifflin-St Jeor es de 166 kcal: elegir una por defecto no es un matiz, es inventar el resultado. Se devuelve `null` y la interfaz explica qué falta. Mismo criterio que los rangos de laboratorio de la Rebanada 5 y las fórmulas de pliegues de la 13.

6. **Katch-McArdle solo aparece si hay masa libre de grasa.** Parte de la composición corporal y no usa sexo ni edad; sin ese dato es inservible, y ofrecerla deshabilitada explica por qué mejor que ocultarla.

7. **Los deslizadores reparten en proporción, no a partes iguales.** Subir la proteína de 20 a 30 en un reparto 20/50/30 quita más a los carbohidratos que a la grasa, que es lo que el profesional espera ver. El segundo valor absorbe el redondeo para que la suma sea exactamente 100.

8. **La prescripción se acota por clínica y alcance, no por autoría.** La especificación pedía comprobar que quien escribe sea el autor de la consulta; eso impediría que un compañero cubra una baja, que es cuando más falta hace.

9. **El plan alimentario se muestra en solo lectura.** Se edita en su propia pestaña del expediente: dos sitios donde tocar lo mismo acaban discrepando. Aquí lo que hace falta es comprobar qué se prescribió.

---

## Dos correcciones a la especificación

### Las proporciones de intercambios dejaban fuera el 20 % de la energía

Las proporciones dadas —0,30 almidones, 0,20 carnes, 0,05 vegetales, 0,07 frutas, 0,08 leche, 0,10 grasas— **suman 0,80**. Los intercambios habrían cubierto solo cuatro quintas partes de la meta calórica, y el profesional habría prescrito, sin verlo, un 20 % menos de lo que acababa de calcular.

Se normalizan a 100 % conservando su peso relativo. Comprobado: para una meta de 2100 kcal, los intercambios ahora suman **2105 kcal**. Sigue siendo una aproximación —un menú por intercambios se ajusta a mano— y la pantalla lo dice.

### El valor esperado de CA-15-08 no corresponde con la fórmula

El criterio decía que Mifflin-St Jeor para una mujer de 38 años, 78 kg y 165 cm da «≈1548 kcal». Con la fórmula que el propio prompt transcribe:

```
(10 × 78) + (6,25 × 165) − (5 × 38) − 161 = 780 + 1031,25 − 190 − 161 = 1460,25
```

El resultado correcto es **1460**, no 1548. La implementación sigue la fórmula publicada; el criterio de prueba se ha corregido. (Harris-Benedict, con los mismos datos, da 1516 — de ahí que ambas fórmulas deban dar resultados distintos, como pedía CA-15-09.)

---

## Otros ajustes contra el código real

| Asumido | Real |
|---|---|
| `utils/calculadora.ts` | El proyecto usa `lib/` |
| `sexo: 'M' \| 'F'` | `masculino \| femenino \| intersexual`; se traduce y se rechaza lo que no aplica |
| `resolverAlcance(request, pacienteId)` | `resolverAlcance(tenantId, sub, roles)` |
| `snake_case` en el contrato | `camelCase` |
| Sin restricción de suma en los porcentajes | `CHECK` en la base y validación en la API |
| `npm run lint` | No existe; `tsc --noEmit` y build |

---

## Contrato de API

| Método | Ruta |
|---|---|
| `GET` | `/api/pacientes/:id/consultas/:consultaId/conclusion` — **404** si aún no existe |
| `PUT` | `/api/pacientes/:id/consultas/:consultaId/conclusion` — UPSERT; **409** si la consulta está finalizada |

Guardar la conclusión marca su sección como completa, igual que las otras cuatro.

---

## Criterios de aceptación

Ver `docs/PRUEBAS.md`, sección Rebanada 15 (CA-15-01 … CA-15-19).
