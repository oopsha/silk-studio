class KeybindingRegistryImpl {
  private readonly bindings = new Map<string, string[]>();

  registerKeybinding(commandId: string, label: string): () => void {
    const current = this.bindings.get(commandId) ?? [];
    if (!current.includes(label)) {
      this.bindings.set(commandId, [...current, label]);
    }

    return () => {
      const next = (this.bindings.get(commandId) ?? []).filter(
        (key) => key !== label,
      );
      if (next.length > 0) {
        this.bindings.set(commandId, next);
      } else {
        this.bindings.delete(commandId);
      }
    };
  }

  lookupKeybinding(commandId: string): string | undefined {
    return this.bindings.get(commandId)?.[0];
  }
}

export const KeybindingsRegistry = new KeybindingRegistryImpl();
