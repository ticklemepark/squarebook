import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Relative base so the static build works at any path (GitHub Pages serves
// the app from /<repo>/ and HashRouter handles routing client-side).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
});
