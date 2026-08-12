/**
 * NutriSmart · Tailwind preset
 * Mapea los tokens de tokens.css a la escala de Tailwind, para escribir
 * clases como bg-primary / text-ink / border-border / shadow-md, y que el
 * white-label (cambio de --primary) se refleje en toda la app sin rebuild.
 *
 * Uso en cada app (tailwind.config.js):
 *   module.exports = { presets: [require('@nutrismart/design-system/tailwind.preset')], content: [...] }
 * y en el CSS global:  @import '@nutrismart/design-system/tokens.css';
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--primary)',
          hover:   'var(--primary-hover)',
          tint:    'var(--primary-tint)',
        },
        background:  'var(--background)',
        surface:     'var(--surface)',
        'surface-2': 'var(--surface-2)',
        border:      'var(--border)',
        ink:         'var(--ink)',
        muted:       'var(--muted)',
        info:        'var(--info)',
        status: {
          normal:   'var(--status-normal)',
          alert:    'var(--status-alert)',
          serious:  'var(--status-serious)',
          critical: 'var(--status-critical)',
        },
        chart: {
          1: 'var(--chart-1)', 2: 'var(--chart-2)',
          3: 'var(--chart-3)', 4: 'var(--chart-4)',
        },
      },
      fontFamily: { sans: ['var(--font-sans)'] },
      borderRadius: {
        sm: 'var(--radius-sm)', md: 'var(--radius-md)',
        lg: 'var(--radius-lg)', pill: 'var(--radius-pill)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)',
      },
      ringColor: { DEFAULT: 'var(--ring)' },
    },
  },
};
