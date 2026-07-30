import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { LayoutService } from "../../services/layout/layoutService";
import { AiChatService } from "../../services/ai/aiChatService";

CommandsRegistry.registerCommand("silk.ai.focusChat", () => {
  LayoutService.showAuxiliaryBar();
  // Wait a frame so the panel mounts before focusing the composer.
  requestAnimationFrame(() => {
    AiChatService.requestFocus();
  });
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: "silk.ai.focusChat",
    title: { value: "Focus AI Chat", mnemonicTitle: "Focus AI &&Chat" },
  },
  group: "3_ai",
  order: 10,
});

KeybindingsRegistry.registerKeybinding("silk.ai.focusChat", "Ctrl+Shift+A");
