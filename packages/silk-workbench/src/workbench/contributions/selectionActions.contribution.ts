import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";

/** Runs a built-in Monaco editor action against whichever editor is focused; no-op otherwise. */
function runEditorAction(actionId: string): void {
  EditorService.getActiveTextEditor()?.getAction(actionId)?.run();
}

CommandsRegistry.registerCommand("silk.selection.selectAll", () => {
  runEditorAction("editor.action.selectAll");
});

CommandsRegistry.registerCommand("silk.selection.expandSelection", () => {
  runEditorAction("editor.action.smartSelect.expand");
});

CommandsRegistry.registerCommand("silk.selection.shrinkSelection", () => {
  runEditorAction("editor.action.smartSelect.shrink");
});

CommandsRegistry.registerCommand("silk.selection.copyLineUp", () => {
  runEditorAction("editor.action.copyLinesUpAction");
});

CommandsRegistry.registerCommand("silk.selection.copyLineDown", () => {
  runEditorAction("editor.action.copyLinesDownAction");
});

CommandsRegistry.registerCommand("silk.selection.moveLineUp", () => {
  runEditorAction("editor.action.moveLinesUpAction");
});

CommandsRegistry.registerCommand("silk.selection.moveLineDown", () => {
  runEditorAction("editor.action.moveLinesDownAction");
});

CommandsRegistry.registerCommand("silk.selection.duplicateSelection", () => {
  runEditorAction("editor.action.duplicateSelection");
});

CommandsRegistry.registerCommand("silk.selection.addCursorAbove", () => {
  runEditorAction("editor.action.insertCursorAbove");
});

CommandsRegistry.registerCommand("silk.selection.addCursorBelow", () => {
  runEditorAction("editor.action.insertCursorBelow");
});

CommandsRegistry.registerCommand(
  "silk.selection.addCursorsToLineEnds",
  () => {
    runEditorAction("editor.action.insertCursorAtEndOfEachLineSelected");
  },
);

CommandsRegistry.registerCommand("silk.selection.addNextOccurrence", () => {
  runEditorAction("editor.action.addSelectionToNextFindMatch");
});

CommandsRegistry.registerCommand(
  "silk.selection.addPreviousOccurrence",
  () => {
    runEditorAction("editor.action.addSelectionToPreviousFindMatch");
  },
);

CommandsRegistry.registerCommand(
  "silk.selection.selectAllOccurrences",
  () => {
    runEditorAction("editor.action.selectHighlights");
  },
);

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.selectAll",
    title: { value: "Select All", mnemonicTitle: "Select &&All" },
  },
  group: "1_selection",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.expandSelection",
    title: {
      value: "Expand Selection",
      mnemonicTitle: "E&&xpand Selection",
    },
  },
  group: "1_selection",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.shrinkSelection",
    title: {
      value: "Shrink Selection",
      mnemonicTitle: "Shrin&&k Selection",
    },
  },
  group: "1_selection",
  order: 30,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.copyLineUp",
    title: { value: "Copy Line Up", mnemonicTitle: "&&Copy Line Up" },
  },
  group: "2_line",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.copyLineDown",
    title: { value: "Copy Line Down", mnemonicTitle: "Co&&py Line Down" },
  },
  group: "2_line",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.moveLineUp",
    title: { value: "Move Line Up", mnemonicTitle: "Mo&&ve Line Up" },
  },
  group: "2_line",
  order: 30,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.moveLineDown",
    title: { value: "Move Line Down", mnemonicTitle: "Move &&Line Down" },
  },
  group: "2_line",
  order: 40,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.duplicateSelection",
    title: {
      value: "Duplicate Selection",
      mnemonicTitle: "&&Duplicate Selection",
    },
  },
  group: "2_line",
  order: 50,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.addCursorAbove",
    title: { value: "Add Cursor Above", mnemonicTitle: "&&Add Cursor Above" },
  },
  group: "3_multi",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.addCursorBelow",
    title: { value: "Add Cursor Below", mnemonicTitle: "A&&dd Cursor Below" },
  },
  group: "3_multi",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.addCursorsToLineEnds",
    title: {
      value: "Add Cursors to Line Ends",
      mnemonicTitle: "Add C&&ursors to Line Ends",
    },
  },
  group: "3_multi",
  order: 30,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.addNextOccurrence",
    title: {
      value: "Add Next Occurrence",
      mnemonicTitle: "Add &&Next Occurrence",
    },
  },
  group: "3_multi",
  order: 40,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.addPreviousOccurrence",
    title: {
      value: "Add Previous Occurrence",
      mnemonicTitle: "Add P&&revious Occurrence",
    },
  },
  group: "3_multi",
  order: 50,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.selectAllOccurrences",
    title: {
      value: "Select All Occurrences",
      mnemonicTitle: "Select All &&Occurrences",
    },
  },
  group: "3_multi",
  order: 60,
});

KeybindingsRegistry.registerKeybinding("silk.selection.shrinkSelection", "Shift+Alt+Left");
KeybindingsRegistry.registerKeybinding("silk.selection.expandSelection", "Shift+Alt+Right");
KeybindingsRegistry.registerKeybinding("silk.selection.copyLineUp", "Shift+Alt+Up");
KeybindingsRegistry.registerKeybinding("silk.selection.copyLineDown", "Shift+Alt+Down");
KeybindingsRegistry.registerKeybinding("silk.selection.moveLineUp", "Alt+Up");
KeybindingsRegistry.registerKeybinding("silk.selection.moveLineDown", "Alt+Down");
KeybindingsRegistry.registerKeybinding("silk.selection.addCursorAbove", "Ctrl+Alt+Up");
KeybindingsRegistry.registerKeybinding("silk.selection.addCursorBelow", "Ctrl+Alt+Down");
KeybindingsRegistry.registerKeybinding(
  "silk.selection.addCursorsToLineEnds",
  "Shift+Alt+I",
);
KeybindingsRegistry.registerKeybinding("silk.selection.addNextOccurrence", "Ctrl+D");
KeybindingsRegistry.registerKeybinding(
  "silk.selection.selectAllOccurrences",
  "Ctrl+Shift+L",
);
