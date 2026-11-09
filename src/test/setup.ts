// Entrée `/vitest` et non l'entrée racine : la racine augmente le namespace
// `jest` global, donc sous Vitest les matchers (`toBeInTheDocument`,
// `toHaveFocus`, `toBeDisabled`…) existaient à l'exécution mais pas au typage —
// `tsc` remontait 21 erreurs TS2339 dans les tests. Cette entrée augmente
// `vitest`'s `Assertion` (node_modules/@testing-library/jest-dom/types/vitest.d.ts).
import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
