import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { ContextKeyService } from "../../platform/context/contextKeyService";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function printEditor(): void {
  if (!ContextKeyService.get("printableTextEditorFocused")) return;
  const tab = EditorService.getActiveTab();
  const snapshot = EditorService.getActiveEditorSnapshot();
  if (!tab || !snapshot || !isPrintableTextTab(tab)) return;

  const printRoot = document.createElement("main");
  printRoot.id = "silk-print-root";
  printRoot.setAttribute("aria-hidden", "true");
  printRoot.innerHTML = `<header>${escapeHtml(tab.label)}</header><pre>${escapeHtml(snapshot.content)}</pre>`;

  const printStyle = document.createElement("style");
  printStyle.textContent = `
    #silk-print-root { display: none; }
    @media print {
      @page { size: auto; margin: 15mm; }
      body > *:not(#silk-print-root) { display: none !important; }
      #silk-print-root { display: block !important; position: static !important; padding: 0; color: #111; background: #fff; }
      #silk-print-root header { margin-bottom: 8mm; font: 10pt sans-serif; }
      #silk-print-root pre { margin: 0; font: 9pt/1.35 Consolas, "Courier New", monospace; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }
    }
  `;
  document.head.append(printStyle);
  document.body.append(printRoot);

  const cleanup = () => {
    printRoot.remove();
    printStyle.remove();
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  const fallback = window.setTimeout(cleanup, 60_000);
  window.addEventListener("afterprint", () => window.clearTimeout(fallback), {
    once: true,
  });
  window.setTimeout(() => window.print(), 50);
}

function isPrintableTextTab(tab: NonNullable<ReturnType<typeof EditorService.getActiveTab>>): boolean {
  const uri = tab.uri ?? "";
  // Alternative object/property panes are not text documents. DDL and PL/SQL source
  // tabs are text buffers and are intentionally printable.
  return !uri.startsWith("silk://") ||
    uri.startsWith("silk://plsql/") ||
    uri.startsWith("silk://ddl/");
}

CommandsRegistry.registerCommand("silk.file.exit", async () => {
  if (isTauri()) {
    await getCurrentWindow().close();
  }
});

CommandsRegistry.registerCommand("silk.file.print", printEditor);

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.newTextFile",
    title: { value: "New Text File", mnemonicTitle: "&&New Text File" },
  },
  group: "1_file",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.print",
    title: { value: "Print", mnemonicTitle: "&&Print" },
  },
  group: "2_save",
  order: 50,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  submenu: MenuId.MenubarRecentSqlEditorsMenu,
  title: "Open Recent Items",
  group: "1_file",
  order: 30,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.openFile",
    title: { value: "Open File...", mnemonicTitle: "&&Open File..." },
  },
  group: "1_file",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.save",
    title: { value: "Save", mnemonicTitle: "&&Save" },
  },
  group: "2_save",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.saveAs",
    title: { value: "Save As...", mnemonicTitle: "Save &&As..." },
  },
  group: "2_save",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "workbench.action.closeActiveEditor",
    title: { value: "Close", mnemonicTitle: "&&Close" },
  },
  group: "2_save",
  order: 40,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.exit",
    title: { value: "Exit", mnemonicTitle: "E&&xit" },
  },
  group: "9_exit",
  order: 10,
});
