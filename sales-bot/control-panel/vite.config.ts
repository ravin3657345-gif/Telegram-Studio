import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 2 dev server conventions — fixed port, no auto-open, ignore src-tauri.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1422,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
