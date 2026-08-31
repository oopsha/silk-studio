import { KeybindingsRegistry } from "./keybindingRegistry";
import {
  loadKeybindingOverrides,
  saveKeybindingOverrides,
} from "./keybindingOverridesStorage";

/**
 * User keybinding overrides — a layer on top of `KeybindingsRegistry`'s factory defaults.
 * `initialize()` must run once, after every `*.contribution.ts` has registered its default
 * keybinding (so `KeybindingsRegistry.getDefaultKeybindings` has something to fall back to on
 * reset) — see the call in `main.tsx`.
 */
class UserKeybindingsServiceImpl {
  private overrides = new Map<string, string[]>();
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    for (const override of loadKeybindingOverrides()) {
      this.overrides.set(override.commandId, override.keys);
      KeybindingsRegistry.setBindings(override.commandId, override.keys);
    }
  }

  isOverridden(commandId: string): boolean {
    return this.overrides.has(commandId);
  }

  /** Replaces `commandId`'s active keybinding(s) with `keys` and persists the override. */
  setKeybinding(commandId: string, keys: string[]): void {
    this.overrides.set(commandId, keys);
    KeybindingsRegistry.setBindings(commandId, keys);
    this.persist();
  }

  /** Restores `commandId` to its factory-default keybinding(s), dropping the override. */
  resetKeybinding(commandId: string): void {
    if (!this.overrides.has(commandId)) return;
    this.overrides.delete(commandId);
    KeybindingsRegistry.setBindings(
      commandId,
      KeybindingsRegistry.getDefaultKeybindings(commandId),
    );
    this.persist();
  }

  private persist(): void {
    saveKeybindingOverrides(
      [...this.overrides.entries()].map(([commandId, keys]) => ({
        commandId,
        keys,
      })),
    );
  }
}

export const UserKeybindingsService = new UserKeybindingsServiceImpl();
