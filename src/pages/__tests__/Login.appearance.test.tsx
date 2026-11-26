import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppearanceProvider } from "@/contexts/AppearanceContext";
import Login from "../Login";

const auth = vi.hoisted(() => ({ signIn: vi.fn(), signUp: vi.fn(), resetPassword: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

function showLogin() {
  return render(<AppearanceProvider><MemoryRouter initialEntries={["/login"]}><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/" element={<h1>Espace de gestion</h1>} />
  </Routes></MemoryRouter></AppearanceProvider>);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark", "light");
  vi.resetAllMocks();
  auth.signIn.mockResolvedValue({ error: null });
  auth.signUp.mockResolvedValue({ error: null });
  auth.resetPassword.mockResolvedValue({ error: null });
});
afterEach(cleanup);

it("conserve les champs d’inscription quand on change la présentation puis utilise le même appel d’inscription", async () => {
  const user = userEvent.setup();
  showLogin();
  await user.click(screen.getByRole("button", { name: "Créer un compte" }));
  await user.type(screen.getByLabelText("Nom complet"), "Aïcha Diallo");
  await user.type(screen.getByLabelText("Email professionnel"), "aicha@example.test");
  await user.type(screen.getByLabelText("Mot de passe", { exact: true }), "password-123");
  await user.click(screen.getByRole("button", { name: "Apparence" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("radio", { name: /Entreprise/ }));
  await user.click(within(dialog).getByRole("button", { name: "Terminer" }));
  expect(screen.getByLabelText("Nom complet")).toHaveValue("Aïcha Diallo");
  expect(screen.getByLabelText("Email professionnel")).toHaveValue("aicha@example.test");
  expect(screen.getByLabelText("Mot de passe", { exact: true })).toHaveValue("password-123");
  await user.click(screen.getByRole("button", { name: "Créer le compte" }));
  expect(auth.signUp).toHaveBeenCalledExactlyOnceWith("aicha@example.test", "password-123", "Aïcha Diallo");
  expect(await screen.findByRole("status")).toHaveTextContent("Vérifiez votre email");
  expect(screen.getByLabelText("Mot de passe", { exact: true })).toHaveValue("");
  expect(localStorage.getItem("qerp-auth-layout")).toBe("enterprise");
});

it("affiche une erreur neutre de connexion et permet de corriger le mot de passe", async () => {
  const user = userEvent.setup();
  auth.signIn.mockResolvedValueOnce({ error: { code: "invalid_credentials", message: "Invalid login credentials" } });
  showLogin();
  await user.type(screen.getByLabelText("Email professionnel"), "aicha@example.test");
  await user.type(screen.getByLabelText("Mot de passe", { exact: true }), "wrong-password");
  await user.click(screen.getByRole("button", { name: "Se connecter" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Email ou mot de passe incorrect");
  await user.clear(screen.getByLabelText("Mot de passe", { exact: true }));
  await user.type(screen.getByLabelText("Mot de passe", { exact: true }), "correct-password");
  await user.click(screen.getByRole("button", { name: "Se connecter" }));
  expect(await screen.findByRole("heading", { name: "Espace de gestion" })).toBeInTheDocument();
});

it("récupère après une erreur réseau inattendue et conserve l’email pour la récupération", async () => {
  const user = userEvent.setup();
  auth.signIn.mockRejectedValueOnce(new Error("network unavailable"));
  showLogin();
  await user.type(screen.getByLabelText("Email professionnel"), "aicha@example.test");
  await user.type(screen.getByLabelText("Mot de passe", { exact: true }), "password-123");
  await user.click(screen.getByRole("button", { name: "Se connecter" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Réessayez");
  expect(screen.getByRole("button", { name: "Se connecter" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Mot de passe oublié ?" }));
  await user.click(screen.getByRole("button", { name: "Envoyer le lien" }));
  expect(auth.resetPassword).toHaveBeenCalledExactlyOnceWith("aicha@example.test");
  expect(await screen.findByRole("status")).toHaveTextContent("Lien de réinitialisation envoyé");
});

it("restaure le thème et la présentation après un nouveau montage sans stocker les identifiants", async () => {
  const user = userEvent.setup();
  const view = showLogin();
  await user.click(screen.getByRole("button", { name: "Apparence" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("radio", { name: "Sombre" }));
  await user.click(within(dialog).getByRole("radio", { name: /Entreprise/ }));
  await user.click(within(dialog).getByRole("button", { name: "Terminer" }));
  await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
  view.unmount();
  showLogin();
  await user.click(screen.getByRole("button", { name: "Apparence" }));
  expect(screen.getByRole("radio", { name: "Sombre" })).toBeChecked();
  expect(screen.getByRole("radio", { name: /Entreprise/ })).toBeChecked();
  expect(Object.keys(localStorage).sort()).toEqual(["qerp-auth-layout", "qerp-theme"]);
});
