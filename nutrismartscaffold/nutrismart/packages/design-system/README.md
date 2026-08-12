# @nutrismart/design-system

Fuente de verdad visual. Uso en cada app:

1. En el CSS global:  `@import '@nutrismart/design-system/tokens.css';`
2. En `tailwind.config.js`:
   `module.exports = { presets: [require('@nutrismart/design-system/tailwind.preset')], content: [...] }`
3. White-label: `<html data-brand="azul-clinico">` (o inyecta `--primary` desde la config de la clínica).
