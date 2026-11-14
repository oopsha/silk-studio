import { describe, expect, it, beforeEach, vi } from "vitest";

// Lightweight unit tests for binding helpers without Tauri.

const editorState = vi.hoisted(() => ({
  activeTabId: null as string | null,
  groups: [] as Array<{
    id: string;
    tabs: Array<{ id: string; languageId: string; uri?: string }>;
  }>,
  listeners: new Set<() => void>(),
}));

vi.mock("@silk-studio/editor/services/editor/editorServiceFacade.ts", () => {
  const focusedTabs = () => editorState.groups[0]?.tabs ?? [];
  const notify = () => {
    for (const listener of editorState.listeners) listener();
  };
  return {
    EditorService: {
      getTabs: focusedTabs,
      getActiveTab: () => focusedTabs().find((tab) => tab.id === editorState.activeTabId) ?? focusedTabs()[0] ?? null,
      onDidChange: (listener: () => void) => {
        editorState.listeners.add(listener);
        return () => editorState.listeners.delete(listener);
      },
      __reset() {
        editorState.activeTabId = null;
        editorState.groups.splice(0, editorState.groups.length, {
          id: "group-1",
          tabs: [],
        });
        editorState.listeners.clear();
      },
      __addTab(tab: { id: string; languageId: string; uri?: string }) {
        focusedTabs().push(tab);
        editorState.activeTabId = tab.id;
        notify();
      },
      __addGroup(id: string) {
        editorState.groups.push({ id, tabs: [] });
      },
      __addTabToGroup(id: string, tab: { id: string; languageId: string }) {
        editorState.groups.find((group) => group.id === id)?.tabs.push(tab);
        notify();
      },
    },
  };
});

vi.mock("@silk-studio/editor/services/editor/editorGroupsService.ts", () => ({
  EditorGroupsService: {
    getGroupIds: () => editorState.groups.map((group) => group.id),
    getGroup: (id: string) => ({
      getTabs: () => editorState.groups.find((group) => group.id === id)?.tabs ?? [],
    }),
  },
}));

vi.mock("./connectionService", () => ({
  ConnectionService: {
    getState: () => ({
      connectedProfileId: "p1",
      connectedProfileIds: ["p1"],
      activeProfileId: "p1",
    }),
    getProfile: (id: string) =>
      (id === "p1" || id === "p2")
        ? {
            id,
            name: "Prod",
            driverId: "oracle",
            url: "jdbc:oracle",
            user: "HR",
            password: "",
            catalog: "",
            defaultSchema: "HR",
            showSystemObjects: false,
            createdAt: 0,
            updatedAt: 0,
          }
        : undefined,
    onDidChange: () => () => {},
  },
}));

vi.mock("../sql/sqlDialect", () => ({
  isSqlLanguageId: (id: string) =>
    id === "sql" || id === "plsql" || id === "mysql" || id === "pgsql",
}));

describe("EditorConnectionBindingService", () => {
  beforeEach(async () => {
    vi.resetModules();
    const editor = await import(
      "@silk-studio/editor/services/editor/editorServiceFacade.ts"
    );
    (editor.EditorService as unknown as { __reset: () => void }).__reset();
  });

  it("does not use the last connected profile when no context is available", async () => {
    const { EditorConnectionBindingService: bindings } = await import("./editorConnectionBindingService");
    const { EditorService } = await import("@silk-studio/editor/services/editor/editorServiceFacade.ts");
    bindings.start();
    (EditorService as unknown as { __addTab: (tab: { id: string; languageId: string }) => void })
      .__addTab({ id: "unbound", languageId: "sql" });
    expect(bindings.getBinding("unbound").profileId).toBeNull();
  });

  it.each(["object", "ddl", "plsql"])("uses the %s object's connection before Explorer and last-connected profiles", async (kind) => {
    const { EditorConnectionBindingService: bindings } = await import("./editorConnectionBindingService");
    const { EditorService } = await import("@silk-studio/editor/services/editor/editorServiceFacade.ts");
    bindings.start();
    bindings.setExplorerProfileId("p1");
    (EditorService as unknown as { __addTab: (tab: { id: string; languageId: string; uri: string }) => void })
      .__addTab({ id: "object", languageId: "sql", uri: `silk://${kind}/p2/dbo/table/ORDERS?catalog=SHOP` });
    expect(bindings.getBinding("object")).toEqual({ profileId: "p2", catalog: "SHOP", schema: "dbo" });
  });

  it("prefers Explorer for generic commands, source editor for editor commands, and inherits when no selection exists", async () => {
    const { EditorConnectionBindingService: bindings } = await import("./editorConnectionBindingService");
    const { EditorService } = await import("@silk-studio/editor/services/editor/editorServiceFacade.ts");
    const editor = EditorService as unknown as { __addTab: (tab: { id: string; languageId: string }) => void };
    bindings.start();
    editor.__addTab({ id: "source", languageId: "sql" });
    bindings.setBinding("source", { profileId: "p2", catalog: "SHOP", schema: "sales" });
    bindings.setExplorerProfileId("p1");
    expect(bindings.resolveNewEditorBinding().profileId).toBe("p1");
    expect(bindings.resolveNewEditorBinding(true).profileId).toBe("p2");
    bindings.setExplorerProfileId(null);
    editor.__addTab({ id: "new", languageId: "sql" });
    expect(bindings.getBinding("new")).toEqual({ profileId: "p2", catalog: "SHOP", schema: "sales" });
  });

  it("opens an object with a missing profile unbound instead of targeting a different database", async () => {
    const { EditorConnectionBindingService: bindings } = await import("./editorConnectionBindingService");
    const { EditorService } = await import("@silk-studio/editor/services/editor/editorServiceFacade.ts");
    bindings.start();
    bindings.setExplorerProfileId("p1");
    (EditorService as unknown as { __addTab: (tab: { id: string; languageId: string; uri: string }) => void })
      .__addTab({ id: "missing", languageId: "sql", uri: "silk://object/deleted/dbo/table/ORDERS" });
    expect(bindings.getBinding("missing").profileId).toBeNull();
  });

  it("uses the explicitly selected Explorer connection for new SQL tabs", async () => {
    const { EditorConnectionBindingService } = await import(
      "./editorConnectionBindingService"
    );
    const editor = await import(
      "@silk-studio/editor/services/editor/editorServiceFacade.ts"
    );
    EditorConnectionBindingService.start();
    EditorConnectionBindingService.setExplorerProfileId("p1");
    (
      editor.EditorService as unknown as {
        __addTab: (tab: { id: string; languageId: string }) => void;
      }
    ).__addTab({ id: "tab-1", languageId: "sql" });

    const binding = EditorConnectionBindingService.getBinding("tab-1");
    expect(binding.profileId).toBe("p1");
    expect(binding.schema).toBe("HR");
  });

  it("keeps bindings for tabs in other editor groups", async () => {
    const { EditorConnectionBindingService } = await import(
      "./editorConnectionBindingService"
    );
    const editor = await import(
      "@silk-studio/editor/services/editor/editorServiceFacade.ts"
    );
    const service = editor.EditorService as unknown as {
      __addGroup: (id: string) => void;
      __addTabToGroup: (id: string, tab: { id: string; languageId: string }) => void;
    };

    EditorConnectionBindingService.start();
    EditorConnectionBindingService.setExplorerProfileId("p1");
    service.__addGroup("group-2");
    service.__addTabToGroup("group-2", { id: "tab-2", languageId: "sql" });

    expect(EditorConnectionBindingService.getBinding("tab-2")).toEqual({
      profileId: "p1",
      catalog: null,
      schema: "HR",
    });
  });

  it("setBinding updates only that tab", async () => {
    const { EditorConnectionBindingService } = await import(
      "./editorConnectionBindingService"
    );
    EditorConnectionBindingService.start();
    EditorConnectionBindingService.setBinding("a", {
      profileId: "p1",
      schema: "A",
    });
    EditorConnectionBindingService.setBinding("b", {
      profileId: "p1",
      schema: "B",
    });
    expect(EditorConnectionBindingService.getBinding("a").schema).toBe("A");
    expect(EditorConnectionBindingService.getBinding("b").schema).toBe("B");
  });

  it("setBindingsForAllSqlTabs updates every SQL tab", async () => {
    const { EditorConnectionBindingService } = await import(
      "./editorConnectionBindingService"
    );
    const editor = await import(
      "@silk-studio/editor/services/editor/editorServiceFacade.ts"
    );
    const svc = editor.EditorService as unknown as {
      __reset: () => void;
      __addTab: (tab: { id: string; languageId: string }) => void;
    };
    svc.__reset();
    EditorConnectionBindingService.start();
    svc.__addTab({ id: "tab-1", languageId: "sql" });
    svc.__addTab({ id: "tab-2", languageId: "plsql" });
    svc.__addTab({ id: "tab-3", languageId: "plaintext" });

    EditorConnectionBindingService.setBindingsForAllSqlTabs({
      profileId: "p1",
      catalog: null,
      schema: "ALL",
    });

    expect(EditorConnectionBindingService.getBinding("tab-1").schema).toBe(
      "ALL",
    );
    expect(EditorConnectionBindingService.getBinding("tab-2").schema).toBe(
      "ALL",
    );
    expect(
      EditorConnectionBindingService.getBinding("tab-3").profileId,
    ).toBeNull();
  });
});
