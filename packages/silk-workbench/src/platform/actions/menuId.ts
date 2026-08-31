export class MenuId {
  private static readonly instances = new Map<string, MenuId>();

  static readonly MenubarMainMenu = MenuId.create("MenubarMainMenu");
  static readonly MenubarFileMenu = MenuId.create("MenubarFileMenu");
  static readonly MenubarEditMenu = MenuId.create("MenubarEditMenu");
  static readonly MenubarSelectionMenu = MenuId.create("MenubarSelectionMenu");
  static readonly MenubarViewMenu = MenuId.create("MenubarViewMenu");
  static readonly MenubarGoMenu = MenuId.create("MenubarGoMenu");
  static readonly MenubarRunMenu = MenuId.create("MenubarRunMenu");
  static readonly MenubarConnectionMenu = MenuId.create("MenubarConnectionMenu");
  static readonly MenubarHelpMenu = MenuId.create("MenubarHelpMenu");
  static readonly CommandCenter = MenuId.create("CommandCenter");
  static readonly CommandCenterCenter = MenuId.create("CommandCenterCenter");
  static readonly LayoutControlMenu = MenuId.create("LayoutControlMenu");
  static readonly GlobalActivity = MenuId.create("GlobalActivity");
  static readonly GlobalActivityThemesSubmenu = MenuId.create(
    "GlobalActivityThemesSubmenu",
  );
  static readonly AccountsContext = MenuId.create("AccountsContext");

  private constructor(readonly id: string) {}

  private static create(id: string): MenuId {
    let instance = MenuId.instances.get(id);
    if (!instance) {
      instance = new MenuId(id);
      MenuId.instances.set(id, instance);
    }
    return instance;
  }
}
