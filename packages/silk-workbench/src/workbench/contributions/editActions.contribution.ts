import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";

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

KeybindingsRegistry.registerKeybinding("silk.edit.undo", "Ctrl+Z");
KeybindingsRegistry.registerKeybinding("silk.edit.redo", "Ctrl+Y");
KeybindingsRegistry.registerKeybinding("silk.edit.cut", "Ctrl+X");
KeybindingsRegistry.registerKeybinding("silk.edit.copy", "Ctrl+C");
KeybindingsRegistry.registerKeybinding("silk.edit.paste", "Ctrl+V");
