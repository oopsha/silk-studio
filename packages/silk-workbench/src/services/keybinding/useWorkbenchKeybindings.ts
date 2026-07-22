import { useEffect } from "react";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";

export function useWorkbenchKeybindings(): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      KeybindingsRegistry.handleKeyboardEvent(event);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);
}
