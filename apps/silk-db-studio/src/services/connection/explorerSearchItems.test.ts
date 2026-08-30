import { describe, expect, it, vi } from "vitest";
import type { FoundMetadataObject } from "@silk-studio/db-protocol";

// `explorerSearchItems.ts` pulls in `./metadataGroups`, which imports the workbench's
// `I18nService` singleton — that module eagerly touches `document` at import time (to apply the
// active theme/configuration), which doesn't exist under vitest's default `node` environment.
// Mocking the group-definition lookup keeps this test focused on the pure mapping logic under
// test without dragging in that unrelated DOM dependency (the same root cause as the pre-existing
// `commandCatalog.test.ts` failure noted in this repo's test baseline).
vi.mock("./metadataGroups", () => ({
  getMetadataGroupDefinition: (id: string) => ({ id, title: id, icon: `icon-${id}` }),
}));

const { buildLiveSearchResultPick } = await import("./explorerSearchItems");

describe("buildLiveSearchResultPick", () => {
  it("maps a schema-scoped result (no catalog) into an object pick", () => {
    const found: FoundMetadataObject = {
      schemaName: "APP",
      name: "ORDERS",
      kind: "table",
    };
    const pick = buildLiveSearchResultPick("profile-1", undefined, found);

    expect(pick.type).toBe("object");
    expect(pick.profileId).toBe("profile-1");
    expect(pick.schemaName).toBe("APP");
    expect(pick.catalogName).toBeUndefined();
    expect(pick.label).toBe("ORDERS");
    expect(pick.description).toBe("APP · Table");
    expect(pick.object).toEqual({ name: "ORDERS", kind: "table" });
  });

  it("includes the catalog in the description for catalog-explorer dialects", () => {
    const found: FoundMetadataObject = {
      catalogName: "AdventureWorks",
      schemaName: "dbo",
      name: "Customers",
      kind: "view",
    };
    const pick = buildLiveSearchResultPick("profile-2", undefined, found);

    expect(pick.catalogName).toBe("AdventureWorks");
    expect(pick.description).toBe("AdventureWorks.dbo · View");
  });

  it("prefixes the description with the profile label when given (multi-connection search)", () => {
    const found: FoundMetadataObject = {
      schemaName: "public",
      name: "accounts",
      kind: "table",
    };
    const pick = buildLiveSearchResultPick("profile-3", "Prod DB", found);

    expect(pick.description).toBe("[Prod DB] public · Table");
  });

  it("produces a stable, unique id per profile/catalog/schema/kind/name", () => {
    const a = buildLiveSearchResultPick("profile-1", undefined, {
      schemaName: "APP",
      name: "ORDERS",
      kind: "table",
    });
    const b = buildLiveSearchResultPick("profile-1", undefined, {
      schemaName: "APP",
      name: "ORDERS",
      kind: "view",
    });
    expect(a.id).not.toBe(b.id);
  });
});
