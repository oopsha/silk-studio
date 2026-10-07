export type PackageDdlCommands = {
  save: () => void;
  compile: () => void;
};

const commandsByTabId = new Map<string, PackageDdlCommands>();

export function registerPackageDdlCommands(
  tabId: string,
  commands: PackageDdlCommands,
): () => void {
  commandsByTabId.set(tabId, commands);
  return () => {
    if (commandsByTabId.get(tabId) === commands) {
      commandsByTabId.delete(tabId);
    }
  };
}

export function getPackageDdlCommands(tabId: string): PackageDdlCommands | undefined {
  return commandsByTabId.get(tabId);
}
