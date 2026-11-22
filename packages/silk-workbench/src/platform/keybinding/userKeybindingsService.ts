import { KeybindingsRegistry } from "./keybindingRegistry";
import {
  loadKeybindingOverrides,
  saveKeybindingOverrides,
  syncKeybindingOverrides,
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
    // The file is the source of truth: when it differs from the browser copy, it wins.
    syncKeybindingOverrides((saved) => {
      const next = new Map(saved.map((override) => [override.commandId, override.keys] as const));
      for (const commandId of this.overrides.keys()) {
        if (!next.has(commandId)) {
          KeybindingsRegistry.setBindings(commandId, KeybindingsRegistry.getDefaultKeybindings(commandId));
        }
      }
      this.overrides = next;
      for (const [commandId, keys] of next) KeybindingsRegistry.setBindings(commandId, keys);
    });
  }

  /** Applies the loaded overrides again; for apps that register defaults after `initialize()`
   *  (or re-register them, e.g. React StrictMode remounts). */
  reapply(): void {
    this.initialize();
    for (const [commandId, keys] of this.overrides) {
      KeybindingsRegistry.setBindings(commandId, keys);
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
