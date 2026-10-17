/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--orbit-background)',
        foreground: 'var(--orbit-text)',
        muted: {
          DEFAULT: 'var(--orbit-muted)',
          foreground: 'var(--orbit-text-secondary)',
        },
        border: 'var(--orbit-border)',
        input: 'var(--orbit-muted)',
        card: {
          DEFAULT: 'var(--orbit-surface)',
          foreground: 'var(--orbit-text)',
        },
        accent: {
          DEFAULT: 'var(--orbit-brand)',
          foreground: 'var(--orbit-on-brand)',
          light: 'var(--orbit-brand-soft)',
        },
        primary: {
          DEFAULT: 'var(--orbit-text)',
          foreground: 'var(--orbit-background)',
        }
      },
      borderRadius: {
        'xl': 'var(--orbit-space-4)',
        '2xl': 'var(--orbit-space-5)',
      },
      animation: {
        'cursor-blink': 'blink 1s infinite',
      },
      keyframes: {
        blink: {
          '0%, 50%': { opacity: '1' },
          '51%, 100%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  }
}
