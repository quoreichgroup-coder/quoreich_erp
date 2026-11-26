import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JournalEntryPreview } from "../JournalEntryPreview";
import { GLPostingKPIsLive, GLBatchHistoryLive, GLAuditHistoryLive } from "@/hooks/use-gl-batches";

const mocks = vi.hoisted(() => ({ permissions: ["ar.invoice"], get: vi.fn(), from: vi.fn() }));
vi.mock("@/hooks/use-my-access", () => ({ useMyAccess: () => ({ isSuccess: true, data: { roles: [], permissions: mocks.permissions } }) }));
vi.mock("@/api/client", () => ({ isApiEnabled: () => true, apiGet: mocks.get }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));

beforeEach(() => {
  mocks.permissions = ["ar.invoice"];
  mocks.get.mockReset(); mocks.from.mockReset();
});
afterEach(cleanup);

describe("widgets du grand livre dans un module auxiliaire", () => {
  it("un rôle AR seul ne monte aucun aperçu ni aucune requête GL", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}>
      <JournalEntryPreview entryId="entry-1" />
      <GLPostingKPIsLive module="AR" />
      <GLBatchHistoryLive module="AR" />
      <GLAuditHistoryLive module="AR" />
    </QueryClientProvider>);
    expect(view.container).toBeEmptyDOMElement();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    client.clear();
  });

  it("un comptable conserve l'aperçu de l'écriture de facture", async () => {
    mocks.permissions = ["ar.invoice", "accounting.chart"];
    mocks.get.mockResolvedValue({ entry_number: "VT-001", entry_date: "2026-11-21", status: "posted", lines: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><JournalEntryPreview entryId="entry-1" /></QueryClientProvider>);
    expect(await screen.findByTestId("journal-entry-preview")).toHaveTextContent("VT-001");
    client.clear();
  });
});
