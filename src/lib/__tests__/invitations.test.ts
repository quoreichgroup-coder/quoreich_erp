import { describe, expect, it } from "vitest";
import { invitationStatus, sortInvitations, type InvitationRow } from "../invitations";

const now = new Date("2026-11-13T12:00:00Z");
const row = (over: Partial<InvitationRow>): InvitationRow => ({
  id: "i", code: "AAAA-BBBB-CCCC-DDDD", role_id: "r", note: null,
  created_at: "2026-11-10T00:00:00Z", expires_at: "2026-11-20T00:00:00Z",
  used_at: null, used_by: null, revoked_at: null, ...over,
});

describe("statut d'une invitation", () => {
  it("active tant qu'elle n'est ni utilisée, ni révoquée, ni expirée", () => {
    expect(invitationStatus(row({}), now)).toBe("active");
    expect(invitationStatus(row({ expires_at: "2026-11-13T11:59:59Z" }), now)).toBe("expired");
  });

  it("utilisée ou révoquée prime sur l'expiration : c'est ce qui s'est passé", () => {
    expect(invitationStatus(row({ used_at: "2026-11-11T00:00:00Z", expires_at: "2026-11-12T00:00:00Z" }), now)).toBe("used");
    expect(invitationStatus(row({ revoked_at: "2026-11-11T00:00:00Z", expires_at: "2026-11-12T00:00:00Z" }), now)).toBe("revoked");
  });

  it("tri : actives d'abord, puis les plus récentes", () => {
    const sorted = sortInvitations([
      row({ id: "ancienne-active", created_at: "2026-11-01T00:00:00Z" }),
      row({ id: "recente-utilisee", created_at: "2026-11-12T00:00:00Z", used_at: "2026-11-12T01:00:00Z" }),
      row({ id: "recente-active", created_at: "2026-11-12T00:00:00Z" }),
    ], now);
    expect(sorted.map((r) => r.id)).toEqual(["recente-active", "ancienne-active", "recente-utilisee"]);
  });
});
