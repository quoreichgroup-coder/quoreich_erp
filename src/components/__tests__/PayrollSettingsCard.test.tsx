import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  settingsError: false,
  canEdit: true,
  upsert: vi.fn(),
  rpc: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: mocks.settingsError ? null : mocks.settings, error: mocks.settingsError ? new Error("offline") : null }),
        upsert: (value: Record<string, unknown>) => {
          mocks.upsert(value);
          mocks.settings = value;
          return builder;
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: [{ tenant_id: "tenant-1" }], error: null }).then(resolve, reject),
      };
      return builder;
    },
    rpc: mocks.rpc,
  },
}));
vi.mock("@/hooks/use-tenant", () => ({ useTenantId: () => ({ data: "tenant-1" }) }));
vi.mock("@/hooks/use-my-access", () => ({
  useMyAccess: () => ({ data: { permissions: mocks.canEdit ? ["hr.payroll_settings"] : [] } }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

import { PayrollSettingsCard } from "@/components/PayrollSettingsCard";

afterEach(cleanup);
beforeEach(() => {
  mocks.settings = null;
  mocks.settingsError = false;
  mocks.canEdit = true;
  mocks.upsert.mockReset();
  mocks.rpc.mockReset().mockImplementation(async () => {
    if (mocks.settings) mocks.settings.rules_validated_at = "2032-01-01T00:00:00Z";
    return { error: null };
  });
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PayrollSettingsCard /></QueryClientProvider>);
}

describe("PayrollSettingsCard", () => {
  it("blocks saving and offers recovery when stored settings cannot be read", async () => {
    mocks.settingsError = true;
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Enregistrement bloqué");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Enregistrer les règles" })).toBeDisabled();
  });

  it("does not suggest the legacy 16.4% as a confirmed legal rate", async () => {
    renderCard();
    const employerRate = await screen.findByLabelText("Cotisation employeur (%)") as HTMLInputElement;
    expect(employerRate.value).toBe("");
    expect(screen.getByText(/Aucun taux légal n’est prérempli/)).toBeTruthy();
  });

  it("requires a full country profile before saving or confirming", async () => {
    renderCard();
    await screen.findByLabelText("Code pays (ISO 3166-1 alpha-2)");
    expect(screen.getByRole("button", { name: "Enregistrer les règles" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirmer les barèmes" })).toBeDisabled();
  });

  it("saves the configured rules before allowing explicit confirmation", async () => {
    renderCard();
    const country = await screen.findByLabelText("Code pays (ISO 3166-1 alpha-2)");
    await waitFor(() => expect(country).toBeEnabled());
    fireEvent.change(country, { target: { value: "BF" } });
    fireEvent.change(screen.getByLabelText("Devise (ISO 4217)"), { target: { value: "XOF" } });
    fireEvent.change(screen.getByLabelText("Cotisation salariale (%)"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Cotisation employeur (%)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Date d’effet"), { target: { value: "2032-01-01" } });
    fireEvent.change(screen.getByLabelText("Source officielle / référence juridique"), { target: { value: "Texte fiscal de test, article 1" } });
    fireEvent.change(screen.getByLabelText("Taux marginal (%)"), { target: { value: "10" } });

    expect(screen.getByLabelText("Code pays (ISO 3166-1 alpha-2)")).toHaveValue("BF");
    expect(screen.getByLabelText("Devise (ISO 4217)")).toHaveValue("XOF");
    expect(screen.getByLabelText("Date d’effet")).toHaveValue("2032-01-01");
    expect(screen.getByLabelText("Taux marginal (%)")).toHaveValue(10);

    const save = screen.getByRole("button", { name: "Enregistrer les règles" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Confirmer les barèmes" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Confirmer les barèmes" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("confirm_payroll_rules"));
    await waitFor(() => expect(screen.getByText(/Confirmés · BF/)).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Cotisation employeur (%)"), { target: { value: "11" } });
    expect(screen.getByRole("button", { name: "Confirmer les barèmes" })).toBeDisabled();
    expect(screen.getByText("À configurer ou confirmer")).toBeTruthy();
  });

  it("keeps the rules read-only without the payroll settings permission", async () => {
    mocks.canEdit = false;
    renderCard();
    await screen.findByText(/Lecture seule/);
    expect(screen.queryByRole("button", { name: "Enregistrer les règles" })).toBeNull();
    expect(screen.getByLabelText("Code pays (ISO 3166-1 alpha-2)")).toBeDisabled();
  });
});
