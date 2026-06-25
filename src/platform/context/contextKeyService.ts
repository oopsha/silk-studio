type ContextChangeListener = () => void;

class ContextKeyServiceImpl {
  private readonly keys = new Map<string, boolean>();
  private readonly listeners = new Set<ContextChangeListener>();

  set(key: string, value: boolean): void {
    const current = this.keys.get(key);
    if (current === value) return;
    this.keys.set(key, value);
    this.fireDidChange();
  }

  get(key: string): boolean {
    return this.keys.get(key) ?? false;
  }

  evaluate(expression: string | undefined): boolean {
    if (!expression) return true;

    if (expression.startsWith("config.")) {
      const configKey = expression.slice("config.".length);
      return ConfigurationService.getValue<boolean>(configKey) !== false;
    }

    return this.get(expression);
  }

  onDidChangeContext(listener: ContextChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

class ConfigurationServiceImpl {
  private readonly values = new Map<string, unknown>([
    ["window.commandCenter", true],
    ["workbench.navigationControl.enabled", true],
    ["workbench.layoutControl.enabled", true],
  ]);

  getValue<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
}

export const ContextKeyService = new ContextKeyServiceImpl();
export const ConfigurationService = new ConfigurationServiceImpl();
