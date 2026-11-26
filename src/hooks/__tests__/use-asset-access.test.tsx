import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { MyAccess } from "../use-my-access";

const mocks = vi.hoisted(() => ({ access: { roles: [], permissions: [] } as MyAccess }));
vi.mock("@/hooks/use-my-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("../use-my-access")>(),
  useMyAccess: () => ({ data: mocks.access }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "member" } }) }));
import { useMyFixedAssetRoles } from "../use-fixed-assets-data";

afterEach(cleanup);

describe("immobilisations : droits personnalisés", () => {
  it("un rôle standard ne rétablit pas les actions décochées", () => {
    mocks.access = { roles: ["asset_admin"], permissions: ["assets.manage"] };
    const { result } = renderHook(() => useMyFixedAssetRoles());
    expect(result.current.canCreate).toBe(true);
    expect(result.current.canRunDepreciation).toBe(false);
    expect(result.current.canDispose).toBe(false);
    expect(result.current.canManageCategories).toBe(false);
  });

  it("Comptable et rôles sur mesure peuvent utiliser les actions effectivement accordées", () => {
    mocks.access = { roles: ["accountant"], permissions: ["assets.depreciate"] };
    const { result, rerender } = renderHook(() => useMyFixedAssetRoles());
    expect(result.current.canRunDepreciation).toBe(true);
    expect(result.current.canCreate).toBe(false);
    mocks.access = { roles: [], permissions: ["assets.dispose", "assets.settings"] };
    rerender();
    expect(result.current.canDispose).toBe(true);
    expect(result.current.canManageCategories).toBe(true);
    expect(result.current.canRunDepreciation).toBe(false);
  });
});
