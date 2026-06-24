class KeybindingRegistryImpl {
  private readonly bindings = new Map<string, string>();

  registerKeybinding(commandId: string, label: string): () => void {
    this.bindings.set(commandId, label);
    return () => this.bindings.delete(commandId);
  }

  lookupKeybinding(commandId: string): string | undefined {
    return this.bindings.get(commandId);
  }
}

export const KeybindingsRegistry = new KeybindingRegistryImpl();
