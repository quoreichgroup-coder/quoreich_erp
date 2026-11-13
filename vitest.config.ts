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
    // Par défaut Vitest lance (cœurs − 1) environnements jsdom en parallèle — 19 sur ce poste de
    // 20 cœurs, chacun de 150 à 300 Mo : c'est ce qui épuisait la mémoire et produisait
    // « Timeout waiting for worker ». Plafond local à 4 (VITEST_MAX_WORKERS le change) ; la CI
    // garde le défaut de Vitest.
    maxWorkers: process.env.VITEST_MAX_WORKERS ?? (process.env.CI ? undefined : 4),
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
