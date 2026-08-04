import { useCallback, useEffect, useState } from "react";

import {

  MenuId,

  MenuService,

  type ResolvedToolbarEntry,

} from "../../../../platform/actions/menuService";

import { CommandService } from "../../../../platform/commands/commandService";

import {

  ContextKeyService,

  ConfigurationService,

} from "../../../../platform/context/contextKeyService";

import { WindowTitleService } from "../../../../services/windowTitle/windowTitleService";

import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";

import { useOpenEditorsQuickPickOptional } from "../OpenEditorsQuickPick/openEditorsQuickPickContext";

import "./CommandCenter.css";



function useCommandCenterActions(): ResolvedToolbarEntry[] {

  const [actions, setActions] = useState(() =>

    MenuService.getToolbarActions(MenuId.CommandCenter),

  );



  useEffect(() => {

    function refresh() {

      setActions(MenuService.getToolbarActions(MenuId.CommandCenter));

    }



    const disposeMenu = MenuService.onDidChangeMenu(refresh);

    const disposeContext = ContextKeyService.onDidChangeContext(refresh);

    return () => {

      disposeMenu();

      disposeContext();

    };

  }, []);



  return actions;

}



function useWorkspaceName(): string {

  const [name, setName] = useState(() =>

    WindowTitleService.getWorkspaceName(),

  );



  useEffect(() => {

    return WindowTitleService.onDidChange(() => {

      setName(WindowTitleService.getWorkspaceName());

    });

  }, []);



  return name;

}



function useTitlebarQuickPickActive(): boolean {
  const [active, setActive] = useState(() =>
    document.documentElement.classList.contains("titlebar-quick-pick-active"),
  );

  useEffect(() => {
    function sync() {
      setActive(
        document.documentElement.classList.contains("titlebar-quick-pick-active"),
      );
    }

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return active;
}

function CommandCenter() {
  const actions = useCommandCenterActions();
  const workspaceName = useWorkspaceName();
  const quickPick = useOpenEditorsQuickPickOptional();
  const externalQuickPickOpen = useTitlebarQuickPickActive();
  const quickPickOpen = (quickPick?.open ?? false) || externalQuickPickOpen;

  const commandCenterEnabled =
    ConfigurationService.getValue("window.commandCenter") !== false;



  const handleAction = useCallback(async (commandId: string) => {

    await CommandService.executeCommand(commandId);

  }, []);



  if (!commandCenterEnabled) {

    return (

      <div

        className={`window-title${quickPickOpen ? " window-title--quick-pick-active" : ""}`}

        data-open-editors-anchor

      >

        {!quickPickOpen ? (

          <span className="window-title__label">{workspaceName}</span>

        ) : null}

      </div>

    );

  }



  const centerSubmenu = actions.find(

    (item) => item.type === "submenu" && item.menuId === MenuId.CommandCenterCenter,

  );

  const centerActions = centerSubmenu

    ? MenuService.getToolbarActions(MenuId.CommandCenterCenter)

    : [];

  const quickOpenAction = centerActions.find(

    (item): item is Extract<ResolvedToolbarEntry, { type: "command" }> =>

      item.type === "command",

  );



  return (

    <div className="window-title">

      <div className="command-center">

        <div className="command-center__toolbar" role="toolbar">

          {actions.map((item) => {

            if (item.type === "submenu") {

              return (

                <button

                  key={item.menuId.id}

                  type="button"

                  className={`command-center__center${quickPickOpen ? " command-center__center--quick-pick-active" : ""}`}

                  data-open-editors-anchor

                  data-command-center-anchor

                  title={quickOpenAction?.label ?? "Search"}

                  aria-label={workspaceName}

                  aria-hidden={quickPickOpen}

                  tabIndex={quickPickOpen ? -1 : 0}

                  onClick={() => {

                    if (quickPickOpen) return;

                    if (quickOpenAction) {

                      void handleAction(quickOpenAction.id);

                    }

                  }}

                >

                  {!quickPickOpen ? (

                    <span className="command-center__quick-pick">

                      <span className="command-center__center-label">

                        {workspaceName}

                      </span>

                    </span>

                  ) : null}

                </button>

              );

            }



            return (

              <button

                key={item.id}

                type="button"

                className="command-center__action"

                title={item.label}

                aria-label={item.label}

                disabled={!item.enabled}

                onClick={() => void handleAction(item.id)}

              >

                {item.icon ? <Codicon name={item.icon} /> : item.label}

              </button>

            );

          })}

        </div>

      </div>

    </div>

  );

}



export default CommandCenter;

