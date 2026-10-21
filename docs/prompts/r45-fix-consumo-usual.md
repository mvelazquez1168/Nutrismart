# R45 — Fix Consumo Usual: texto de banner, lógica sin paréntesis y reconocimiento de abreviaturas clínicas

Crea la rama `r45-fix-consumo-usual` desde `main` y aplica los siguientes cambios.

**Contexto:** Hay tres problemas en la sección Consumo Usual de la tabla dietética:
1. El banner dice "Si no escribes ningún paréntesis, se analiza todo el texto" — el comportamiento correcto es que sin paréntesis NO se analiza nada.
2. El AI prompt no reconoce abreviaturas clínicas comunes ("harinas", "protes") y las pone en `sin_equivalencia` en vez de clasificarlas en el grupo ADA correcto.
3. La interfaz muestra "2 alimentos sin equivalencia" pero el usuario no ve claramente cuántos SÍ fueron clasificados, lo que genera confusión ("de dónde vienen los valores si dijo que no encontró nada").

---

## Paso 0 — Pull de main

```
git checkout main && git pull origin main
git checkout -b r45-fix-consumo-usual
```

---

## Bloque 1 — Lógica: sin paréntesis → sin análisis

### Archivo: `apps/api/src/dietetico/parentesis.ts`

Leer el archivo completo.

La función `textoAAnalizar(texto, tipo)` actualmente devuelve `null` cuando no hay paréntesis en un `consumo_usual` para que el llamador pueda seguir con el texto completo. **Cambiar este comportamiento:** el retorno `null` ahora debe significar "no analizar" (el llamador lo detectará y abortará el análisis).

No se necesita cambio en el código de este archivo porque `null` YA es lo que devuelve. El cambio está en el llamador (ver Bloque 2).

### Archivo: `apps/api/src/routes/registroDietetico.ts`

Leer el archivo completo. Localizar el endpoint `POST .../analizar-ia`.

Dentro del handler, después de calcular `textoParsado = textoAAnalizar(texto, tipo)` (o el nombre de variable que use el código real), agregar esta guardia ANTES de llamar a la IA:

```typescript
// Consumo usual sin paréntesis → limpiar valores AI y retornar sin llamar a la IA
if (textoParsado === null) {
  const limpiado = await pool.query(
    `update registro_dietetico_fila
        set ai_kcal = null, ai_cho_g = null, ai_prot_g = null, ai_grasas_g = null,
            ai_calculado_en = null, ai_no_encontrado = null
      where id = $1
      returning *`,
    [fila.id],
  )
  // Retornar el registro actualizado con cero/null en campos AI y lista vacía
  return reply.send({ ...respuesta(actualizado con los datos de limpiado), _sinEquivalencia: [] })
}
```

> **Nota de implementación:** adaptar `respuesta(...)` con la fila que devuelva el UPDATE. Observar cómo el handler ya lee y mapea filas del repositorio y replicar ese patrón. El punto clave es que no se llame a `llamarClaude` ni a ninguna función de IA en este camino.

---

## Bloque 2 — Prompt ADA: reconocimiento de abreviaturas clínicas

### Archivo: `apps/api/src/routes/registroDietetico.ts`

Localizar la constante `SISTEMA_ADA`. Dentro de las instrucciones al asistente, agregar **antes** de la instrucción que dice "Si un alimento entre paréntesis no tiene equivalencia clara...":

```
Abreviaturas clínicas comunes que DEBES reconocer como alimentos con equivalencia ADA:
- "harinas", "harina", "cereal(es)", "grano(s)", "pan" → grupo Cereales
- "protes", "proteína(s)", "carne(s)", "pollo", "pescado", "huevo" → grupo Carnes (magras por defecto salvo que se indique lo contrario)
- "lácteos", "leche", "yogur", "queso fresco" → grupo Leche (estimar según si dice descremado, semi o entero)
- "fruta(s)" como término genérico → grupo Frutas
- "verdura(s)", "vegetal(es)" como término genérico → grupo Vegetales
- "grasa(s)", "aceite", "mantequilla", "aguacate" → grupo Grasas
- "azúcar(es)", "dulce(s)", "miel" → grupo Azúcares

Si una abreviatura indica cantidad + grupo ("2 harinas", "3 protes"), interpreta la cantidad como el número de intercambios de ese grupo y clasifícala ahí, NO en sin_equivalencia.
```

---

## Bloque 3 — UI: texto del banner y claridad del resultado

### Archivo: `apps/web-professional/src/components/eval/TablaDietetica.tsx`

Leer el archivo completo.

**Cambio A — Texto del banner informativo**

Localizar el bloque JSX del banner (el `<div>` con `border border-[color:var(--status-alert)]` que solo se muestra cuando `tipo === 'consumo_usual'`). Reemplazar el texto interior para que diga:

```tsx
<span className="font-semibold text-[color:var(--status-alert)]">ⓘ </span>
Para la búsqueda de equivalencias en la lista de intercambios solo se consideran los alimentos
que escribas{' '}
<strong className="font-semibold">entre paréntesis ( )</strong>.
Si no incluyes ningún paréntesis,{' '}
<strong className="font-semibold">no se realiza el análisis ADA</strong>.
```

**Cambio B — Mensaje de sin equivalencia más claro**

Localizar donde se muestra el badge / texto de sin equivalencia (algo como `{(sinEquivalencia[f.tiempo_comida] ?? []).length > 0 && ...}`).

Antes de ese bloque, buscar también donde se muestran los badges de `analizado` (CHO, Prot, etc.). Agregar junto a los badges un pequeño contador cuando hay alimentos sin equivalencia, de manera que el profesional vea ambos datos juntos. El texto nuevo debe decir cuántos fueron clasificados vs sin equivalencia:

```tsx
{analizado && (
  <div className="mt-1 flex flex-wrap items-center gap-1.5">
    {/* badges existentes de kcal, CHO, Prot, Grasas — no tocar */}
    {(sinEquivalencia[f.tiempo_comida] ?? []).length > 0 && (
      <span className="text-xs text-[color:var(--status-alert)]">
        · {sinEquivalencia[f.tiempo_comida]!.length} sin equivalencia ADA
      </span>
    )}
  </div>
)}
```

Y la lista de alimentos sin equivalencia que ya existe debajo (el `<p>` con "Sin equivalencia ADA: ...") mantenerla igual.

> **Nota:** el cambio es solo agregar el contador junto a los badges; no duplicar la lista de alimentos.

---

## Commit

```
git add apps/api/src/routes/registroDietetico.ts \
        apps/web-professional/src/components/eval/TablaDietetica.tsx

git commit -m "fix(r45): consumo usual sin paréntesis no analiza; abreviaturas clínicas en ADA; banner corregido

- Sin paréntesis en consumo_usual → limpia valores AI, no llama a la IA
- SISTEMA_ADA reconoce harinas/protes/lácteos como grupos ADA
- Banner: 'Si no incluyes paréntesis, no se realiza el análisis ADA'
- Badge muestra '· N sin equivalencia ADA' junto a los macros

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ES8ko4NzY3HXWX6HJ2zwy6"

git push origin r45-fix-consumo-usual
```
