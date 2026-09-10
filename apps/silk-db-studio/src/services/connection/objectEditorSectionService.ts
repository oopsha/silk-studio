export type ObjectEditorSection = "properties" | "data";

const activeSectionByTabId = new Map<string, ObjectEditorSection>();
const listeners = new Set<(tabId: string, section: ObjectEditorSection) => void>();

export function getObjectEditorSection(tabId: string): ObjectEditorSection | undefined {
  return activeSectionByTabId.get(tabId);
}

export function setObjectEditorSection(tabId: string, section: ObjectEditorSection): void {
  activeSectionByTabId.set(tabId, section);
  listeners.forEach((listener) => listener(tabId, section));
}

export function onDidChangeObjectEditorSection(listener: (tabId: string, section: ObjectEditorSection) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
