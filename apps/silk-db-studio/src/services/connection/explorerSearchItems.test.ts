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

const { buildLiveSearchResultPick, buildExplorerSearchPicksAcrossProfiles } = await import("./explorerSearchItems");

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

  it("appends a truncated comment snippet to the description when present", () => {
    const found: FoundMetadataObject = {
      schemaName: "APP",
      name: "ORDERS",
      kind: "table",
      commentSnippet:
        "  This is a very long table comment that goes on for quite a while and should  \n  get truncated well past eighty characters of total length here  ",
    };
    const pick = buildLiveSearchResultPick("profile-1", undefined, found);

    expect(pick.description.startsWith("APP · Table — ")).toBe(true);
    expect(pick.description.length).toBeLessThanOrEqual(
      "APP · Table — ".length + 80,
    );
    expect(pick.description.endsWith("…")).toBe(true);
  });

  it("omits the comment separator when commentSnippet is absent", () => {
    const found: FoundMetadataObject = {
      schemaName: "APP",
      name: "ORDERS",
      kind: "table",
    };
    const pick = buildLiveSearchResultPick("profile-1", undefined, found);

    expect(pick.description).not.toContain(" — ");
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

describe("combined object search", () => {
  const found: FoundMetadataObject = {
    catalogName: "SWM", schemaName: "dbo", kind: "procedure", name: "PS_CM_MSG_SEND",
  };
  const cache = {
    status: "loaded" as const, errorMessage: null, catalogs: [], currentCatalog: null,
    schemas: [],
  };

  it("finds previously fetched objects as input narrows, changes or clears", () => {
    const profiles = [{ profileId: "p", label: "Database", cache, searchObjects: [found] }];
    for (const filter of ["ps_cm_", "msg", "ps*msg", ""]) {
      expect(buildExplorerSearchPicksAcrossProfiles(profiles, filter).map((pick) => pick.label))
        .toContain(found.name);
    }
    expect(buildExplorerSearchPicksAcrossProfiles(profiles, "not_found")).toEqual([]);
  });

  it("deduplicates tree and fetched hits without conflating different connections", () => {
    const tree = {
      ...cache,
      catalogs: [{ name: "SWM", status: "loaded" as const, errorMessage: null, schemas: [{
        name: "dbo", status: "loaded" as const, errorMessage: null,
        groups: [{ id: "procedures" as const, title: "Procedures", objects: [{
          name: found.name, kind: "procedure" as const,
        }] }],
      }] }],
    };
    const picks = buildExplorerSearchPicksAcrossProfiles([
      { profileId: "p1", label: "First", cache: tree, searchObjects: [found] },
      { profileId: "p2", label: "Second", cache, searchObjects: [found] },
    ], "msg");
    expect(picks).toHaveLength(2);
    expect(new Set(picks.map((pick) => pick.id)).size).toBe(2);
  });

  it("keeps comment matches and excludes non-navigable object kinds", () => {
    const picks = buildExplorerSearchPicksAcrossProfiles([{
      profileId: "p", label: "Database", cache,
      searchObjects: [{ ...found, commentSnippet: "Send notifications" }, {
        ...found, kind: "index", name: "notifications_index",
      }],
    }], "notifications");
    expect(picks.map((pick) => pick.label)).toEqual([found.name]);
  });
});
