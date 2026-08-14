/**
 * Tailwind v3, con el preset del design system.
 *
 * No se redefine ningun color de marca aqui. El preset ya mapea
 * bg-primary, text-ink, border-border… contra las variables de
 * tokens.css, y eso es lo que hace que la app se vista con los colores
 * de la clinica del paciente sin volver a compilar.
 */
module.exports = {
  presets: [require('@nutrismart/design-system/tailwind.preset')],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
}
