import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    // `PORT` est la convention déjà utilisée par les specs Playwright
    // (`process.env.PORT ?? "8080"`). Sans cette lecture, un `PORT=8081` posé
    // côté tests n'avait aucun effet ici et Vite retombait en silence sur le
    // port suivant : les specs interrogeaient alors le 8080, occupé sur ce poste
    // par le conteneur `frappe_docker_official_latest-frontend-1`.
    port: Number(process.env.PORT) || 8080,
    hmr: {
      overlay: false,
    },
  },
  // `lovable-tagger` a été retiré : outil de l'éditeur Lovable, il déclare un
  // pair `vite < 8` et bloquait la montée de Vite.
  plugins: [react()],
  resolve: {
    alias: {
      // `import.meta.dirname` (et non `__dirname`) : Vite 8 bascule vers un
      // chargeur de configuration natif qui ne fournit pas `__dirname`.
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Découpage du bundle.
         *
         * Les pages sont chargées par route (`React.lazy` dans `App.tsx`) ; ce
         * qui reste à décider, c'est le sort des dépendances partagées. On
         * n'isole ici **que** ce qui est réellement chargé au premier écran :
         * React, le routeur, TanStack Query, Supabase, Radix et les utilitaires
         * de classe. Ces chunks restent stables d'une version à l'autre et
         * restent en cache navigateur.
         *
         * `recharts` et `jspdf` ne sont **volontairement pas** listés :
         * `jspdf` est chargé par `import()` au clic (`src/lib/pdf-export.ts`) et
         * `recharts` n'apparaît que dans des pages lazy, donc Rollup les range
         * dans les chunks qui les utilisent. Les forcer dans un `manualChunks`
         * produisait l'effet inverse : Rollup y déversait aussi les modules
         * applicatifs partagés, ce qui rendait ces 1,1 Mo de dépendances
         * *statiquement* importés par l'entrée et préchargés à chaque visite.
         *
         * Les motifs sont ancrés sur `node_modules/<paquet>/` : un simple
         * `id.includes("recharts")` attraperait aussi les dépendances imbriquées.
         */
        manualChunks(id) {
          // Le helper `__vitePreload` doit rester dans un chunk minuscule :
          // laissé au placement automatique, il atterrit dans un chunk lourd,
          // qui devient alors une dépendance statique de l'entrée.
          if (id.includes("preload-helper")) return "vendor-preload";

          if (!id.includes("node_modules")) return;
          const m = (pkg: string) => id.includes(`node_modules/${pkg}/`);

          if (m("clsx") || m("tailwind-merge") || m("class-variance-authority")) {
            return "vendor-ui-utils";
          }
          if (m("@supabase")) return "vendor-supabase";
          if (m("@radix-ui")) return "vendor-radix";
          if (m("@tanstack")) return "vendor-query";
          if (m("react-router") || m("react-router-dom") || m("@remix-run")) return "vendor-router";
          if (m("react") || m("react-dom") || m("scheduler")) return "vendor-react";
        },
      },
    },
  },
}));