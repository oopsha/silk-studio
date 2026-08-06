import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { LayoutService } from "../../services/layout/layoutService";
import { AiAuditLogDialogService } from "../../services/ai/aiAuditLogDialogService";
import { AiChatService } from "../../services/ai/aiChatService";

CommandsRegistry.registerCommand("silk.ai.focusChat", () => {
  LayoutService.showAuxiliaryBar();
  // Wait a frame so the panel mounts before focusing the composer.
  requestAnimationFrame(() => {
    AiChatService.requestFocus();
  });
});

CommandsRegistry.registerCommand("silk.ai.showCallLog", () => {
  AiAuditLogDialogService.show();
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: "silk.ai.focusChat",
    title: { value: "Focus AI Chat", mnemonicTitle: "Focus AI &&Chat" },
  },
  group: "3_ai",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: {
    id: "silk.ai.showCallLog",
    title: { value: "AI Call Log", mnemonicTitle: "AI &&Call Log" },
  },
  group: "2_diagnostics",
  order: 30,
});

KeybindingsRegistry.registerKeybinding("silk.ai.focusChat", "Ctrl+Shift+A");
