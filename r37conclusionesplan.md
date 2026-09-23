# Rebanada 37 — Integración del plan alimentario y mejoras al formulario de conclusiones

## Contexto

El formulario de conclusiones del expediente clínico tiene secciones: Prescripción, Acuerdos con el paciente, y otras. Se requiere integrar el plan alimentario entre Prescripción y Acuerdos, mejorar el campo de restricciones, agregar un campo de Objetivos, y conectar la calculadora para que alimente automáticamente el encabezado del plan.

---

## Paso 1 — Localizar archivos relevantes

```bash
# Formulario de conclusiones
grep -r "Conclusiones\|Prescripci\|Acuerdos\|conclusiones" apps/web-professional/src --include="*.tsx" -l

# Calculadora
grep -r "Calculadora\|calculadora\|meta.*calórica\|MetaCalorica\|intercambio" apps/web-professional/src --include="*.tsx" -l

# Plan alimentario
grep -r "PlanAlimentario\|plan.*alimentario\|plan alimentario" apps/web-professional/src --include="*.tsx" -l

# Restricciones actuales
grep -r "renal\|diabetico\|restriccion\|Restriccion" apps/web-professional/src --include="*.tsx" -l
```

Lee cada archivo completo antes de editar.

---

## Cambio 1 — Nuevo campo "Objetivos" en conclusiones

Agrega un campo **Objetivos** de texto libre (textarea) en el formulario de conclusiones. Posición: antes de Restricciones o como primer campo del formulario, según el orden lógico del flujo clínico.

Usa el mismo patrón visual (label, textarea, clases Tailwind) que los demás campos de texto libre del formulario.

---

## Cambio 2 — Actualizar opciones de Restricciones

En el campo de Restricciones del formulario de conclusiones:

**Eliminar:**
- Renal
- Diabético

**Agregar:**
- Hipocalórica
- Normocalórica
- Hipercalórica
- Alta en fibra
- Fibra soluble
- Fibra insoluble
- Hiperproteica
- Hipoproteica
- Normoproteica

Mantén todas las opciones existentes que no estén en la lista de eliminación. Si es un campo de selección múltiple (checkboxes o multiselect), conserva ese patrón.

---

## Cambio 3 — Botón para abrir la calculadora después de Prescripción

Inmediatamente después del card de **Prescripción**, agrega un botón:

```tsx
<button onClick={() => setCalculadoraAbierta(true)}>
  Abrir calculadora
</button>
```

- Usa el estilo de botón secundario/outline del proyecto (mismas clases que otros botones secundarios)
- Ícono sugerido: calculadora o `BeakerIcon` de heroicons si ya está en uso
- El botón abre la calculadora en un modal o drawer, según el patrón que ya use el proyecto para la calculadora

---

## Cambio 4 — Encabezado del plan alimentario se llena desde la calculadora

Cuando se cierra la calculadora, los siguientes valores deben aparecer como encabezado del plan alimentario:

- **Meta calórica** (ej. "2000 kcal/día")
- **Listas de intercambio** (el desglose de porciones por grupo)

### Implementación sugerida:

```tsx
// Estado para guardar los valores de la calculadora
const [datosCalculadora, setDatosCalculadora] = useState<{
  metaCalorica: number | null
  listasIntercambio: Record<string, number> | null
}>({ metaCalorica: null, listasIntercambio: null })

// Al cerrar la calculadora, recibir los valores
function alCerrarCalculadora(datos: typeof datosCalculadora) {
  setDatosCalculadora(datos)
  setCalculadoraAbierta(false)
}
```

Si la calculadora ya tiene un mecanismo de retorno de valores (callback, contexto, estado global), úsalo. No dupliques la lógica existente.

---

## Cambio 5 — Integrar el plan alimentario en el formulario de conclusiones

El componente de plan alimentario debe insertarse **después de Prescripción y antes de Acuerdos con el paciente**.

Estructura resultante del formulario de conclusiones:
```
1. Objetivos            ← NUEVO
2. Restricciones        ← ACTUALIZADO
3. Prescripción         ← existente
4. [Botón calculadora]  ← NUEVO
5. Plan alimentario     ← INTEGRADO AQUÍ
   - Encabezado: Meta calórica + Listas de intercambio (desde calculadora)
   - Contenido del plan (componente existente)
6. Acuerdos con el paciente  ← existente
7. …resto del formulario
```

Si el plan alimentario es un componente separado, impórtalo aquí. Si no existe aún, crea un componente `PlanAlimentarioCard` con:
- Encabezado que muestra `metaCalorica` y `listasIntercambio` cuando están disponibles (o un placeholder "Abre la calculadora para definir la meta calórica" cuando están vacíos)
- Área de contenido del plan (textarea o editor existente)

---

## Qué NO tocar

- La lógica de guardado del formulario de conclusiones
- El contenido interno de la calculadora
- Los demás campos del formulario de conclusiones
- `apps/web-patient`

---

## Verificación

1. El formulario de conclusiones muestra el campo "Objetivos"
2. Restricciones NO tiene "Renal" ni "Diabético"
3. Restricciones SÍ tiene las 9 opciones nuevas
4. Después del card de Prescripción hay un botón que abre la calculadora
5. Al cerrar la calculadora, el encabezado del plan muestra la meta calórica y las listas de intercambio
6. El plan alimentario aparece entre Prescripción y Acuerdos con el paciente
