import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";

/** Runs a built-in Monaco editor action against whichever editor is focused; no-op otherwise. */
function runEditorAction(actionId: string): void {
  EditorService.getActiveTextEditor()?.getAction(actionId)?.run();
}

// Monaco (editor) and AG Grid (query result grid) implement their own native undo/redo and
// clipboard handling — the global keybinding registry lets Ctrl+Z/Y/X/C/V pass through
// untouched while focus is inside those widgets (see `NATIVE_CLIPBOARD_COMMANDS` in
// keybindingRegistry.ts). On macOS the native menubar maps these to PredefinedMenuItem
// so the OS handles accelerators. The handlers below cover HTML Edit menu clicks and
// read-only selection copy elsewhere in the workbench.

CommandsRegistry.registerCommand("silk.edit.undo", () => {
  document.execCommand("undo");
});

CommandsRegistry.registerCommand("silk.edit.redo", () => {
  document.execCommand("redo");
});

CommandsRegistry.registerCommand("silk.edit.cut", () => {
  if (document.execCommand("cut")) {
    return;
  }
  void copyCurrentSelectionToClipboard();
});

CommandsRegistry.registerCommand("silk.edit.copy", () => {
  if (document.execCommand("copy")) {
    return;
  }
  void copyCurrentSelectionToClipboard();
});

CommandsRegistry.registerCommand("silk.edit.paste", () => {
  void pasteIntoFocusedEditable();
});

async function copyCurrentSelectionToClipboard(): Promise<void> {
  const text = window.getSelection()?.toString();
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    console.warn("[silk.edit.copy] clipboard write failed", error);
  }
}

async function pasteIntoFocusedEditable(): Promise<void> {
  if (document.execCommand("paste")) {
    return;
  }

  const active = document.activeElement;
  if (
    !(active instanceof HTMLInputElement) &&
    !(active instanceof HTMLTextAreaElement)
  ) {
    return;
  }

  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch (error) {
    console.warn("[silk.edit.paste] clipboard read failed", error);
    return;
  }
  if (!text) {
    return;
  }

  const start = active.selectionStart ?? active.value.length;
  const end = active.selectionEnd ?? active.value.length;
  const value = active.value;
  active.value = value.slice(0, start) + text + value.slice(end);
  const caret = start + text.length;
  active.setSelectionRange(caret, caret);
  active.dispatchEvent(new Event("input", { bubbles: true }));
}

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.undo",
    title: { value: "Undo", mnemonicTitle: "&&Undo" },
  },
  group: "1_undo",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.redo",
    title: { value: "Redo", mnemonicTitle: "&&Redo" },
  },
  group: "1_undo",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.cut",
    title: { value: "Cut", mnemonicTitle: "Cu&&t" },
  },
  group: "2_clipboard",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.copy",
    title: { value: "Copy", mnemonicTitle: "&&Copy" },
  },
  group: "2_clipboard",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.paste",
    title: { value: "Paste", mnemonicTitle: "&&Paste" },
  },
  group: "2_clipboard",
  order: 30,
});

CommandsRegistry.registerCommand("silk.edit.find", () => {
  runEditorAction("actions.find");
});

CommandsRegistry.registerCommand("silk.edit.replace", () => {
  runEditorAction("editor.action.startFindReplaceAction");
});

CommandsRegistry.registerCommand("silk.edit.toggleLineComment", () => {
  runEditorAction("editor.action.commentLine");
});

CommandsRegistry.registerCommand("silk.edit.toggleBlockComment", () => {
  runEditorAction("editor.action.blockComment");
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.find",
    title: { value: "Find", mnemonicTitle: "&&Find" },
  },
  group: "3_find",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.replace",
    title: { value: "Replace", mnemonicTitle: "&&Replace" },
  },
  group: "3_find",
  order: 20,
});

// Silk has no per-file "Find in Files" text search — this opens the same
// object/schema Search view that the Search activity-bar icon and View menu use.
MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.view.search",
    title: { value: "Search", mnemonicTitle: "Sea&&rch" },
  },
  group: "4_search",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.toggleLineComment",
    title: { value: "Toggle Line Comment", mnemonicTitle: "Toggle &&Line Comment" },
  },
  group: "5_comment",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.toggleBlockComment",
    title: { value: "Toggle Block Comment", mnemonicTitle: "Toggle &&Block Comment" },
  },
  group: "5_comment",
  order: 20,
});

KeybindingsRegistry.registerKeybinding("silk.edit.undo", "Ctrl+Z");
KeybindingsRegistry.registerKeybinding("silk.edit.redo", "Ctrl+Y");
KeybindingsRegistry.registerKeybinding("silk.edit.cut", "Ctrl+X");
KeybindingsRegistry.registerKeybinding("silk.edit.copy", "Ctrl+C");
KeybindingsRegistry.registerKeybinding("silk.edit.paste", "Ctrl+V");
KeybindingsRegistry.registerKeybinding("silk.edit.find", "Ctrl+F");
KeybindingsRegistry.registerKeybinding("silk.edit.replace", "Ctrl+H");
KeybindingsRegistry.registerKeybinding("silk.edit.toggleLineComment", "Ctrl+/");
KeybindingsRegistry.registerKeybinding(
  "silk.edit.toggleBlockComment",
  "Shift+Alt+A",
);
