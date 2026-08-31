import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { ContextKeyService } from "../../platform/context/contextKeyService";
import { LayoutService } from "../../services/layout/layoutService";
import { AiAuditLogDialogService } from "../../services/ai/aiAuditLogDialogService";
import { AiAuditLogService } from "../../services/ai/aiAuditLogService";
import { AiChatService } from "../../services/ai/aiChatService";

function updateHasAiCallLogEntriesContextKey(): void {
  ContextKeyService.set(
    "hasAiCallLogEntries",
    AiAuditLogService.getEntries().length > 0,
  );
}

AiAuditLogService.onDidChange(updateHasAiCallLogEntriesContextKey);
updateHasAiCallLogEntriesContextKey();

CommandsRegistry.registerCommand("silk.ai.focusChat", () => {
  LayoutService.showAuxiliaryBar();
  // Wait a frame so the panel mounts before focusing the composer.
  requestAnimationFrame(() => {
    AiChatService.requestFocus();
  });
});

CommandsRegistry.registerCommand("silk.ai.newChat", () => {
  AiChatService.clearSession();
  LayoutService.showAuxiliaryBar();
  requestAnimationFrame(() => {
    AiChatService.requestFocus();
  });
});

CommandsRegistry.registerCommand("silk.ai.showCallLog", () => {
  AiAuditLogDialogService.show();
});

CommandsRegistry.registerCommand("silk.ai.exportCallLog", () => {
  const blob = new Blob([AiAuditLogService.exportJson()], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `silk-ai-audit-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

CommandsRegistry.registerCommand("silk.ai.clearCallLog", () => {
  if (!window.confirm("Clear all AI call log entries? This cannot be undone.")) {
    return;
  }
  AiAuditLogService.clear();
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: "silk.ai.focusChat",
    title: { value: "Focus AI Chat", mnemonicTitle: "Focus AI &&Chat" },
  },
  group: "3_ai",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: "silk.ai.newChat",
    title: { value: "New AI Chat", mnemonicTitle: "&&New AI Chat" },
  },
  group: "3_ai",
  order: 11,
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: {
    id: "silk.ai.showCallLog",
    title: { value: "AI Call Log", mnemonicTitle: "AI &&Call Log" },
  },
  group: "2_diagnostics",
  order: 30,
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: {
    id: "silk.ai.exportCallLog",
    title: {
      value: "Export AI Call Log...",
      mnemonicTitle: "Export AI Call &&Log...",
    },
  },
  group: "2_diagnostics",
  order: 31,
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: {
    id: "silk.ai.clearCallLog",
    title: {
      value: "Clear AI Call Log",
      mnemonicTitle: "Clear AI Call Log",
    },
  },
  group: "2_diagnostics",
  order: 32,
});

KeybindingsRegistry.registerKeybinding("silk.ai.focusChat", "Ctrl+Shift+A");
