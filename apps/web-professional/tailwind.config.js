/**
 * Tailwind v3 (NO v4).
 *
 * El preset del design system usa la forma `theme.extend` de la v3. La v4
 * abandono ese formato por configuracion en CSS, asi que instalarla
 * romperia el preset en silencio: las clases bg-primary, text-ink,
 * bg-status-alert… dejarian de existir sin ningun error de build.
 */
module.exports = {
  presets: [require('@nutrismart/design-system/tailwind.preset')],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /*
         * Solo el acento. `primary` NO se redefine: lo declara el preset
         * del design system contra var(--primary), y volver a mapearlo
         * aqui contra una variable distinta dejaria bg-primary apuntando
         * a un color que nadie escribe.
         */
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
        },
      },
    },
  },
}
