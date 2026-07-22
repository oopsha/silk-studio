import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";

// Monaco (editor) and AG Grid (query result grid) implement their own native undo/redo and
// clipboard handling — the global keybinding registry lets Ctrl+Z/Y/X/C/V pass through
// untouched while focus is inside those widgets (see `NATIVE_CLIPBOARD_COMMANDS` in
// keybindingRegistry.ts). The handlers below therefore only run for plain, read-only text
// surfaces elsewhere in the workbench (error messages, labels, etc.) and via the Edit menu.

CommandsRegistry.registerCommand("silk.edit.undo", () => {
  // No generic document model to undo outside of Monaco/native inputs (handled natively).
});

CommandsRegistry.registerCommand("silk.edit.redo", () => {
  // No generic document model to redo outside of Monaco/native inputs (handled natively).
});

CommandsRegistry.registerCommand("silk.edit.cut", () => {
  // Nothing to remove from read-only text — fall back to copying the current selection.
  void copyCurrentSelectionToClipboard();
});

CommandsRegistry.registerCommand("silk.edit.copy", () => {
  void copyCurrentSelectionToClipboard();
});

CommandsRegistry.registerCommand("silk.edit.paste", () => {
  // No focused native input/textarea/contenteditable — there's nowhere to paste into.
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
