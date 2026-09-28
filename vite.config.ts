import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Axentra@Zuanshi School Monitoring System",
        short_name: "Axentra",
        description: "Attendance and school monitoring for Axentra@Zuanshi.",
        theme_color: "#171717",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "any",
        scope: "/",
        start_url: "/",
        lang: "en",
        categories: ["education", "productivity"],
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // JavaScript route chunks are intentionally not precached. Precache used to
        // download every screen, chart, and ExcelJS even when a user never opened
        // those features. Scripts are now cached only after they are requested.
        // Never cache the deployment HTML shell. A cached index can reference
        // hashed chunks that Render removes during the next deployment.
        globPatterns: ["**/*.{css,ico,png,svg,woff2}"],
        navigateFallback: null,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("lucide-react")) return "icons"
          if (id.includes("@radix-ui")) return "radix"
          if (id.includes("@supabase")) return "supabase"
          if (id.includes("@tanstack")) return "query"
          if (id.includes("recharts")) return "charts"
          if (id.includes("exceljs")) return "exceljs"
          if (id.includes("date-fns")) return "dates"
          return "vendor"
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
