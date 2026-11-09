import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// `import.meta.dirname` (et non `__dirname`) : le chargeur de configuration
// natif de Vite 8, appelé à devenir le défaut, ne fournit pas `__dirname`. Même
// correction que dans `vite.config.ts`.

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
