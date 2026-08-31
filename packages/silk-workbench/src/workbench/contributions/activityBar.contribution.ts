import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { ConfigurationService } from "../../platform/configuration/configurationService";
import { COLOR_THEMES } from "../../platform/configuration/colorThemes";

function registerStubCommand(id: string): void {
  CommandsRegistry.registerCommand(id, () => {
    console.log(`[command] ${id}`);
  });
}

const MANAGE_COMMANDS = [
  "workbench.view.extensions",
  "workbench.userData.actions.manageSettings",
] as const;

const ACCOUNT_COMMANDS = [
  "workbench.userData.actions.manageSettings",
  "silk.account.signIn",
  "silk.account.editProfile",
  "silk.account.signOut",
] as const;

for (const id of [...MANAGE_COMMANDS, ...ACCOUNT_COMMANDS]) {
  registerStubCommand(id);
}

KeybindingsRegistry.registerKeybinding(
  "workbench.action.showCommands",
  "Ctrl+Shift+P",
);
KeybindingsRegistry.registerKeybinding(
  "workbench.view.extensions",
  "Ctrl+Shift+X",
);
KeybindingsRegistry.registerKeybinding(
  "workbench.action.openGlobalKeybindings",
  "Ctrl+K Ctrl+S",
);

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "workbench.action.showCommands",
    title: "Command Palette...",
  },
  group: "1_command",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "silk.explorer.searchObjects",
    title: "Search Database Objects...",
  },
  group: "1_command",
  order: 2,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "workbench.action.openSettings",
    title: "Settings",
  },
  group: "2_configuration",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "workbench.view.extensions",
    title: "Extensions",
  },
  group: "2_configuration",
  order: 2,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "workbench.action.openGlobalKeybindings",
    title: "Keyboard Shortcuts",
  },
  group: "2_configuration",
  order: 3,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  submenu: MenuId.GlobalActivityThemesSubmenu,
  title: "Themes",
  group: "2_configuration",
  order: 4,
});

COLOR_THEMES.forEach((theme, index) => {
  const commandId = `silk.appearance.selectTheme.${theme.id}`;

  CommandsRegistry.registerCommand(commandId, () => {
    ConfigurationService.updateValue("workbench.colorTheme", theme.id);
  });

  MenuRegistry.appendMenuItem(MenuId.GlobalActivityThemesSubmenu, {
    command: {
      id: commandId,
      title: theme.label,
    },
    group: "1_themes",
    order: index + 1,
  });
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "workbench.userData.actions.manageSettings",
    title: "Backup and Sync Settings...",
  },
  group: "3_sync",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "update.check",
    title: "Check for Updates...",
  },
  group: "4_updates",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
  command: {
    id: "silk.account.signIn",
    title: "Sign In...",
  },
  group: "1_account",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
  command: {
    id: "silk.account.editProfile",
    title: "Edit Profile...",
  },
  group: "1_account",
  order: 2,
});

MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
  command: {
    id: "silk.account.signOut",
    title: "Sign Out",
  },
  group: "1_account",
  order: 3,
});

MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
  command: {
    id: "workbench.userData.actions.manageSettings",
    title: "Backup and Sync Settings...",
  },
  group: "2_settings",
  order: 1,
});
