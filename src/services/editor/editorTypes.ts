export type EditorTab = {
  id: string;
  label: string;
  uri?: string;
  languageId: string;
  content: string;
  isDirty: boolean;
  isPreview: boolean;
  isPinned: boolean;
};

export type OpenEditorInput = {
  uri?: string;
  label: string;
  languageId: string;
  content: string;
  preview?: boolean;
};
