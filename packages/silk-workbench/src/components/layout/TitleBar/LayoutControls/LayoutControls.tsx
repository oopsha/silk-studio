import { useEffect, useState } from "react";
import {
  MenuId,
  MenuService,
  type ResolvedToolbarEntry,
} from "../../../../platform/actions/menuService";
import { CommandService } from "../../../../platform/commands/commandService";
import {
  ConfigurationService,
  ContextKeyService,
} from "../../../../platform/context/contextKeyService";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import "./LayoutControls.css";

function useLayoutActions(): ResolvedToolbarEntry[] {
  const [actions, setActions] = useState(() =>
    MenuService.getToolbarActions(MenuId.LayoutControlMenu),
  );

  useEffect(() => {
    function refresh() {
      setActions(MenuService.getToolbarActions(MenuId.LayoutControlMenu));
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

function LayoutControls() {
  const actions = useLayoutActions();
  const layoutControlEnabled =
    ConfigurationService.getValue("workbench.layoutControl.enabled") !== false;

  if (!layoutControlEnabled || actions.length === 0) {
    return null;
  }

  return (
    <div className="layout-controls action-toolbar-container" role="toolbar">
      {actions.map((item) => {
        if (item.type !== "command") return null;

        return (
          <button
            key={item.id}
            type="button"
            className="layout-controls__action"
            title={item.label}
            aria-label={item.label}
            onClick={() => void CommandService.executeCommand(item.id)}
          >
            {item.icon ? <Codicon name={item.icon} /> : item.label}
          </button>
        );
      })}
    </div>
  );
}

export default LayoutControls;
