import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { ConnectionTargetQuickPickService } from "../../services/connection/connectionTargetQuickPickService";

export const CONNECTION_TARGET_COMMANDS = {
  selectTarget: "silk.connection.selectTarget",
} as const;

CommandsRegistry.registerCommand(
  CONNECTION_TARGET_COMMANDS.selectTarget,
  () => {
    ConnectionTargetQuickPickService.show();
  },
);

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: CONNECTION_TARGET_COMMANDS.selectTarget,
    title: "Select Query Target…",
  },
  group: "3_target",
  order: 50,
});

KeybindingsRegistry.registerKeybinding(
  CONNECTION_TARGET_COMMANDS.selectTarget,
  "Ctrl+K Ctrl+O",
);
