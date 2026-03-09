import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.svg", "icons/icon-512.svg", "docs/negocio.txt"],
      manifest: {
        name: "Chat Local del Negocio",
        short_name: "ChatNegocio",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#f8fafc",
        theme_color: "#155eef",
        description: "Chat local del negocio con React, Material Design, WebLLM y soporte offline.",
        icons: [
          {
            src: `${base}icons/icon-192.svg`,
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any maskable"
          },
          {
            src: `${base}icons/icon-512.svg`,
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,txt,png,ico,webmanifest}"],
        navigateFallback: "index.html"
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          mui: ["@mui/material", "@mui/icons-material"],
          webllm: ["@mlc-ai/web-llm"]
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    css: true
  }
});