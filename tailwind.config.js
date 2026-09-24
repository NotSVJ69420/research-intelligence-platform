/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./*.{js,html}"
  ],
  theme: {
    extend: {
      fontFamily: {
        'display': ['Cormorant Garamond', 'serif'],
        'serif': ['EB Garamond', 'serif'],
      },
      colors: {
        'parchment': 'var(--parchment)',
        'cream': 'var(--cream)',
        'burgundy': 'var(--burgundy)',
        'forest-green': 'var(--forest-green)',
        'navy': 'var(--navy)',
        'gold': 'var(--gold)',
        'charcoal': 'var(--charcoal)',
        'sepia': 'var(--sepia)',
        'ink': 'var(--ink)',
      }
    },
  },
  plugins: [],
}