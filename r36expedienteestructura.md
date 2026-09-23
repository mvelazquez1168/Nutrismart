# Rebanada 36 — Reorganización del expediente del paciente (web-professional)

## Contexto

El expediente de un paciente tiene pestañas de nivel superior (Resumen, Historial, Laboratorios…) y una sección "Valoraciones" con subcarpetas (Antropometría, Clínico, Bioquímica). Se requieren cuatro ajustes estructurales y la adición de tres campos nuevos en Sociodemografía.

---

## Paso 1 — Localizar los archivos relevantes

```bash
# Encontrar el componente de pestañas del expediente
grep -r "Resumen\|Historial\|Laboratorios\|Sociodemograf" apps/web-professional/src --include="*.tsx" -l

# Encontrar el componente de Valoraciones y sus subcarpetas
grep -r "Antropometría\|Clínico\|Bioquímica\|Valoracion" apps/web-professional/src --include="*.tsx" -l

# Encontrar los campos que se van a mover
grep -r "actividad.física\|horas.*sue\|fuma\|alcohol" apps/web-professional/src --include="*.tsx" -l
```

Lee cada archivo encontrado antes de editar.

---

## Cambio 1 — Nuevos campos en Sociodemografía

En el componente de Sociodemografía, agrega tres campos nuevos después de los existentes:

- **Religión** — campo de texto libre (o select si ya hay un patrón de opciones en el proyecto)
- **Nacionalidad** — campo de texto libre
- **Lugar de trabajo** — campo de texto libre

Usa exactamente el mismo patrón visual (componente, clases Tailwind, labels) que los campos existentes en Sociodemografía.

---

## Cambio 2 — Subir Sociodemografía al nivel superior

Sociodemografía debe aparecer como pestaña de nivel superior junto a Resumen, Historial, etc., **antes de Laboratorios**.

Orden resultante de pestañas superiores:
```
Resumen | Historial | Sociodemografía | Laboratorios | …
```

Si Sociodemografía estaba dentro de Valoraciones u otro grupo anidado, sácala a ese nivel superior.

---

## Cambio 3 — Laboratorios pasa a Valoraciones (reemplaza Bioquímica)

Dentro de la sección **Valoraciones**, las subcarpetas deben quedar:

```
Valoraciones
  ├── Antropometría
  ├── Clínico
  └── Laboratorios   ← reemplaza "Bioquímica"
```

- Renombra o reemplaza la subcarpeta "Bioquímica" por "Laboratorios"
- El contenido de la pestaña de Laboratorios (nivel superior anterior) debe moverse aquí
- Si "Bioquímica" y "Laboratorios" tenían contenido diferente, consolida en "Laboratorios" manteniendo todo el contenido

---

## Cambio 4 — Mover 4 campos de Sociodemografía a Clínico

Los siguientes campos deben salir de Sociodemografía y aparecer en la subcarpeta **Clínico** de Valoraciones:

- Nivel de actividad física
- Horas de sueño
- Fuma actualmente
- Consumo de alcohol

Agrégalos al final de los campos existentes en Clínico, con el mismo patrón visual.

---

## Qué NO tocar

- El contenido de Resumen e Historial
- La lógica de guardado/API de ninguno de los campos (solo mover la UI)
- El componente de Antropometría
- `apps/web-patient`

---

## Verificación

1. Las pestañas superiores muestran: Resumen, Historial, Sociodemografía, Laboratorios (en ese orden)
2. Sociodemografía tiene los nuevos campos: Religión, Nacionalidad, Lugar de trabajo
3. Sociodemografía NO tiene: Nivel de actividad física, Horas de sueño, Fuma actualmente, Consumo de alcohol
4. Valoraciones → Clínico SÍ tiene esos 4 campos
5. Valoraciones → Laboratorios muestra el contenido correcto
6. No hay referencia a "Bioquímica" visible en la UI
