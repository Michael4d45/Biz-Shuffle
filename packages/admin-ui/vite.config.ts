import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset({ target: "18" })],
    }),
    tailwindcss(),
  ],
  base: "/",
  build: {
    outDir: resolve(__dirname, "../server-host/priv/static"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/state.json": "http://127.0.0.1:8080",
      "/ws": { target: "ws://127.0.0.1:8080", ws: true },
    },
  },
});
