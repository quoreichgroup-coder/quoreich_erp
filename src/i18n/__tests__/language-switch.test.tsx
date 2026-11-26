import { Suspense, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { i18n, switchLanguage, tr } from "@/i18n";
import { CommercialLinesEditor, CommercialTotals } from "@/components/CommercialLinesEditor";
import { emptyLine } from "@/lib/invoice-lines";
import { setFormatPreferences } from "@/lib/locale-format";

vi.mock("@/hooks/use-tenant-currency", () => ({ useTenantCurrency: () => "XOF" }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/DashboardSidebar", () => ({ DashboardSidebar: () => null }));
vi.mock("@/components/TopNav", () => ({ TopNav: () => null }));

afterEach(async () => {
  await act(async () => { await switchLanguage("fr"); });
  setFormatPreferences("fr-FR");
});

function Form() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [lines, setLines] = useState([emptyLine("")]);
  return (
    <div>
      <label htmlFor="email">{t("email")}</label>
      <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <CommercialLinesEditor lines={lines} onChange={setLines} taxCodes={[]} />
      <CommercialTotals lines={lines} taxCodes={[]} testId="totals" />
    </div>
  );
}

describe("changement de langue à chaud (AC02)", () => {
  it("bascule FR → EN → FR sans démonter le formulaire : saisie conservée, libellés et lang changent", async () => {
    const user = userEvent.setup();
    render(<Suspense fallback={<p>chargement</p>}><Form /></Suspense>);
    await user.type(screen.getByLabelText("Email professionnel"), "ana@example.com");
    await user.type(screen.getByLabelText("Libellé ligne 1"), "Conseil");
    await user.type(screen.getByLabelText("Quantité ligne 1"), "2");
    const quantity = (screen.getByLabelText("Quantité ligne 1") as HTMLInputElement).value;
    expect(quantity).toContain("2");

    await act(async () => { await switchLanguage("en"); });
    expect(screen.queryByText("chargement")).toBeNull();
    expect(screen.getByLabelText("Work email")).toHaveValue("ana@example.com");
    expect(screen.getByLabelText("Description line 1")).toHaveValue("Conseil");
    expect(screen.getByLabelText("Quantity line 1")).toHaveValue(quantity);
    expect(screen.getByText("Total incl. VAT")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");

    await act(async () => { await switchLanguage("fr"); });
    expect(screen.getByLabelText("Email professionnel")).toHaveValue("ana@example.com");
    expect(screen.getByText("Total TTC")).toBeInTheDocument();
  });

  it("langue non prise en charge : repli sur le français, jamais de clé brute", async () => {
    await act(async () => { await switchLanguage("de"); });
    expect(i18n.language).toBe("fr");
    expect(tr("auth:email")).toBe("Email professionnel");
  });

  it("messages hors composant (toasts émis par les hooks) dans la langue courante, pluriels compris", async () => {
    await act(async () => { await switchLanguage("en"); });
    expect(tr("sales:dashboard.invoices_count", { count: 1 })).toBe("1 invoice");
    expect(tr("sales:dashboard.invoices_count", { count: 3 })).toBe("3 invoices");
    await act(async () => { await switchLanguage("fr"); });
    expect(tr("sales:dashboard.invoices_count", { count: 1 })).toBe("1 facture");
    expect(tr("common:notifications.bell_unread", { count: 2 })).toBe("Notifications (2 non lues)");
  });

  it("une locale changée seule (sans changer la langue) redessine les montants", async () => {
    render(<CommercialTotals lines={[{ ...emptyLine(""), description: "x", quantity: "1", unitPrice: "1250300" }]} taxCodes={[]} testId="totals" />);
    expect(screen.getByTestId("totals").textContent?.replace(/\s/g, " ")).toContain("1 250 300 XOF");
    act(() => setFormatPreferences("en-US"));
    expect(screen.getByTestId("totals").textContent).toContain("1,250,300 XOF");
  });

  it("un écran non traduit l'annonce en anglais au lieu de mélanger les langues en silence", async () => {
    const { PageShell } = await import("@/components/PageShell");
    const view = (path: string) => render(<MemoryRouter initialEntries={[path]}><PageShell><p>contenu</p></PageShell></MemoryRouter>);
    await act(async () => { await switchLanguage("en"); });
    const untranslated = view("/sales/transactions");
    expect(screen.getByTestId("untranslated-notice")).toHaveTextContent("This screen is not available in English yet: it is shown in French.");
    untranslated.unmount();
    view("/sales");
    expect(screen.queryByTestId("untranslated-notice")).toBeNull();
  });
});
