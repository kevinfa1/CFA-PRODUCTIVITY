import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "CFA — Control de Avance y Productividad",
        short_name: "CFA Obra",
        description: "PWA offline-first para control de avance físico (m²), productividad (m²/HH) y asistencia en obra.",
        theme_color: "#0b1120",
        background_color: "#0b1120",
        display: "standalone",
        orientation: "portrait",
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/uploads": "http://127.0.0.1:8000",
    },
  },
});
