/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        brand: Object.fromEntries([50,100,200,300,400,500,600,700,800,900].map(step => [step, `rgb(var(--brand-${step}) / <alpha-value>)`])),
        accent: '#10b981',
        // Semantic tokens backed by CSS variables (theme-aware)
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        wash: 'rgb(var(--wash, var(--surface2)) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        surface2: 'rgb(var(--surface2) / <alpha-value>)',
        fg: 'rgb(var(--text-base) / <alpha-value>)',
        muted: 'rgb(var(--text-muted) / <alpha-value>)',
        faint: 'rgb(var(--text-faint) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Newsreader', 'Georgia', 'Cambria', 'serif'],
      },
    },
  },
  plugins: [],
}
