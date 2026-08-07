import { describe, expect, it, beforeEach, vi } from "vitest";

// Lightweight unit tests for binding helpers without Tauri.

vi.mock("@silk-studio/editor/services/editor/editorServiceFacade.ts", () => {
  const tabs: Array<{ id: string; languageId: string }> = [];
  const listeners = new Set<() => void>();
  return {
    EditorService: {
      getTabs: () => tabs,
      getActiveTab: () => tabs[0] ?? null,
      onDidChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      __reset() {
        tabs.length = 0;
        listeners.clear();
      },
      __addTab(tab: { id: string; languageId: string }) {
        tabs.push(tab);
        for (const listener of listeners) listener();
      },
    },
  };
});

vi.mock("./connectionService", () => ({
  ConnectionService: {
    getState: () => ({
      connectedProfileId: "p1",
      connectedProfileIds: ["p1"],
      activeProfileId: "p1",
    }),
    getProfile: (id: string) =>
      id === "p1"
        ? {
            id: "p1",
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

  it("assigns default binding for new SQL tabs", async () => {
    const { EditorConnectionBindingService } = await import(
      "./editorConnectionBindingService"
    );
    const editor = await import(
      "@silk-studio/editor/services/editor/editorServiceFacade.ts"
    );
    EditorConnectionBindingService.start();
    (
      editor.EditorService as unknown as {
        __addTab: (tab: { id: string; languageId: string }) => void;
      }
    ).__addTab({ id: "tab-1", languageId: "sql" });

    const binding = EditorConnectionBindingService.getBinding("tab-1");
    expect(binding.profileId).toBe("p1");
    expect(binding.schema).toBe("HR");
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
