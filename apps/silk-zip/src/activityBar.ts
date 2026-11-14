import { COLOR_THEMES } from "@silk-studio/workbench/platform/configuration/colorThemes.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";

const registrationState = globalThis as typeof globalThis & {
  __silkZipActivityMenuRegistered?: boolean;
};

if (!registrationState.__silkZipActivityMenuRegistered) {
  registrationState.__silkZipActivityMenuRegistered = true;

  const commands = [
    { id: "silkZip.activity.commandPalette", title: "명령 팔레트...", group: "1_command", order: 1 },
    { id: "silkZip.activity.settings", title: "설정", group: "2_configuration", order: 1 },
    { id: "silkZip.activity.keybindings", title: "키보드 단축키", group: "2_configuration", order: 2 },
    { id: "silkZip.activity.checkUpdates", title: "업데이트 확인...", group: "4_updates", order: 1 },
  ] as const;

  for (const command of commands) {
    CommandsRegistry.registerCommand(command.id, () => undefined);
    MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
      command: { id: command.id, title: command.title },
      group: command.group,
      order: command.order,
    });
  }

  MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
    submenu: MenuId.GlobalActivityThemesSubmenu,
    title: "테마",
    group: "2_configuration",
    order: 3,
  });

  for (const [index, theme] of COLOR_THEMES.entries()) {
    const id = `silkZip.activity.theme.${theme.id}`;
    CommandsRegistry.registerCommand(id, () => {
      ConfigurationService.updateValue("workbench.colorTheme", theme.id);
    });
    MenuRegistry.appendMenuItem(MenuId.GlobalActivityThemesSubmenu, {
      command: { id, title: theme.label },
      group: "1_themes",
      order: index + 1,
    });
  }
}
