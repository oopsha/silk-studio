import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import {
  formatActiveSqlDocument,
  formatActiveSqlSelection,
} from "../../services/sql/sqlFormatService";

CommandsRegistry.registerCommand("silk.sql.formatDocument", () => {
  formatActiveSqlDocument();
});

CommandsRegistry.registerCommand("silk.sql.formatSelection", () => {
  formatActiveSqlSelection();
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.sql.formatDocument",
    title: { value: "Format Document", mnemonicTitle: "&&Format Document" },
  },
  group: "5_format",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.sql.formatSelection",
    title: { value: "Format Selection", mnemonicTitle: "Format &&Selection" },
  },
  group: "5_format",
  order: 20,
});

KeybindingsRegistry.registerKeybinding(
  "silk.sql.formatDocument",
  "Shift+Alt+F",
);
KeybindingsRegistry.registerKeybinding(
  "silk.sql.formatSelection",
  "Ctrl+K Ctrl+F",
);
