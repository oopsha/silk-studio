import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";

function registerStubCommand(id: string): void {
  CommandsRegistry.registerCommand(id, () => {
    console.log(`[command] ${id}`);
  });
}

const MANAGE_COMMANDS = [
  "workbench.view.extensions",
  "workbench.action.openSnippets",
  "workbench.action.tasks.manage",
  "workbench.userData.actions.manageSettings",
  "workbench.profiles.actions.createTemporaryProfile",
  "workbench.profiles.actions.switchProfile",
  "workbench.action.selectIconTheme",
  "workbench.action.selectProductIconTheme",
] as const;

const ACCOUNT_COMMANDS = [
  "workbench.userData.actions.manageSettings",
  "workbench.userDataSync.actions.turnOn",
  "workbench.remoteTunnel.actions.turnOn",
  "workbench.extensions.actions.manageAccountPreferences",
  "workbench.accounts.actions.manageLanguageModelAccess",
  "workbench.accounts.actions.signIn",
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
  submenu: MenuId.GlobalActivityProfilesSubmenu,
  title: "Profiles",
  group: "2_configuration",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "workbench.action.openSettings",
    title: "Settings",
  },
  group: "2_configuration",
  order: 2,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "workbench.view.extensions",
    title: "Extensions",
  },
  group: "2_configuration",
  order: 3,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "workbench.action.openGlobalKeybindings",
    title: "Keyboard Shortcuts",
  },
  group: "2_configuration",
  order: 4,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "workbench.action.openSnippets",
    title: "Snippets",
  },
  group: "2_configuration",
  order: 5,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  command: {
    id: "workbench.action.tasks.manage",
    title: "Tasks",
  },
  group: "2_configuration",
  order: 6,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
  submenu: MenuId.GlobalActivityThemesSubmenu,
  title: "Themes",
  group: "2_configuration",
  order: 7,
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

MenuRegistry.appendMenuItem(MenuId.GlobalActivityProfilesSubmenu, {
  command: {
    id: "workbench.profiles.actions.createTemporaryProfile",
    title: "Create Temporary Profile...",
  },
  group: "1_profiles",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivityProfilesSubmenu, {
  command: {
    id: "workbench.profiles.actions.switchProfile",
    title: "Switch Profile...",
  },
  group: "1_profiles",
  order: 2,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivityThemesSubmenu, {
  command: {
    id: "workbench.action.selectTheme",
    title: "Color Theme",
  },
  group: "1_themes",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivityThemesSubmenu, {
  command: {
    id: "workbench.action.selectIconTheme",
    title: "File Icon Theme",
  },
  group: "1_themes",
  order: 2,
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivityThemesSubmenu, {
  command: {
    id: "workbench.action.selectProductIconTheme",
    title: "Product Icon Theme",
  },
  group: "1_themes",
  order: 3,
});

MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
  submenu: MenuId.AccountsProviderSubmenu,
  title: "oopsha (GitHub)",
  group: "1_accounts",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
  command: {
    id: "workbench.userData.actions.manageSettings",
    title: "Backup and Sync Settings...",
  },
  group: "2_settings",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
  command: {
    id: "workbench.userDataSync.actions.turnOn",
    title: "Turn on Cloud Changes...",
  },
  group: "2_settings",
  order: 2,
});

MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
  command: {
    id: "workbench.remoteTunnel.actions.turnOn",
    title: "Turn on Remote Tunnel Access...",
  },
  group: "2_settings",
  order: 3,
});

MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
  command: {
    id: "workbench.extensions.actions.manageAccountPreferences",
    title: "Manage Extension Account Preferences...",
  },
  group: "2_settings",
  order: 4,
});

MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
  command: {
    id: "workbench.accounts.actions.manageLanguageModelAccess",
    title: "Manage Language Model Access...",
  },
  group: "2_settings",
  order: 5,
});

MenuRegistry.appendMenuItem(MenuId.AccountsProviderSubmenu, {
  command: {
    id: "workbench.accounts.actions.signIn",
    title: "Sign in to Sync Settings",
  },
  group: "1_account",
  order: 1,
});
