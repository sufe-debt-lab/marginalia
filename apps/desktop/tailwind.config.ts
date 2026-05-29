import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        // shadcn HSL-backed tokens
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        },
        // design hierarchy tokens (raw values)
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
          3: "var(--surface-3)"
        },
        "border-soft": "var(--border-soft)",
        "border-strong": "var(--border-strong)",
        text: {
          DEFAULT: "var(--text)",
          muted: "var(--text-muted)",
          subtle: "var(--text-subtle)",
          faint: "var(--text-faint)"
        },
        brand: {
          DEFAULT: "var(--brand)",
          strong: "var(--brand-strong)",
          soft: "var(--brand-soft)",
          fg: "var(--brand-fg)"
        },
        ok: {
          DEFAULT: "var(--ok)",
          soft: "var(--ok-soft)"
        },
        warn: {
          DEFAULT: "var(--warn)",
          soft: "var(--warn-soft)"
        },
        danger: {
          DEFAULT: "var(--danger)",
          soft: "var(--danger-soft)"
        },
        "code-bg": "var(--code-bg)"
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)"
      },
      fontFamily: {
        sans: [
          "Geist Sans",
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif"
        ],
        serif: ["Source Serif 4 Variable", "Source Serif 4", "Iowan Old Style", "Georgia", "serif"],
        mono: ["Geist Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"]
      }
    }
  },
  plugins: [animate]
};

export default config;
