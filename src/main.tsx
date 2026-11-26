import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initI18n } from "@/i18n";
import "./index.css";

// Les catalogues de démarrage (common, nav, auth, errors) sont chargés avant le premier rendu :
// aucun écran ne s'affiche avec des clés brutes. Un échec de chargement laisse le français (repli).
initI18n().catch(() => undefined).finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
