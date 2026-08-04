export type EditorTab = {
  id: string;
  label: string;
  uri?: string;
  languageId: string;
  content: string;
  isDirty: boolean;
  isPreview: boolean;
  isPinned: boolean;
  /** Optional muted suffix (e.g. connection name). */
  description?: string;
  /** Hover tooltip; falls back to uri/label when omitted. */
  tooltip?: string;
};

export type OpenEditorInput = {
  uri?: string;
  label: string;
  languageId: string;
  content: string;
  preview?: boolean;
};
