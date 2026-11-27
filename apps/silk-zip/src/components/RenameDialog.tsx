import { useEffect, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { tr } from "../i18n";

export interface RenameRequest {
  /** Name shown now (without folders). */
  name: string;
  directory: boolean;
}

interface RenameDialogProps {
  request: RenameRequest;
  /** Dialog heading; defaults to "이름 바꾸기". */
  title?: string;
  /** The initial name is a suggestion (new folder), so submitting it unchanged is allowed. */
  suggested?: boolean;
  /** Names that already exist next to the entry; used to reject duplicates. */
  siblings: readonly string[];
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/** Returns an error message, or null when `name` is acceptable. */
export function validateEntryName(name: string, current: string, siblings: readonly string[]): string | null {
  const value = name.trim();
  if (!value) return tr("이름을 입력하세요.");
  if (/[\\/:*?"<>|]/.test(value) || value === "." || value === "..") return tr("이름에 사용할 수 없는 문자가 있습니다. ( \\ / : * ? \" < > | )");
  if (/[. ]$/.test(value)) return tr("이름은 마침표나 공백으로 끝날 수 없습니다.");
  if (value !== current && siblings.some((sibling) => sibling.toLocaleLowerCase() === value.toLocaleLowerCase())) return tr("같은 이름의 항목이 이미 있습니다.");
  return null;
}

/** Small modal asking for a new entry name; reuses the shared confirm dialog styling. */
export default function RenameDialog({ request, title = tr("이름 바꾸기"), suggested = false, siblings, onSubmit, onCancel }: RenameDialogProps) {
  const [name, setName] = useState(request.name);
  const input = useRef<HTMLInputElement>(null);
  const current = suggested ? "" : request.name;
  const error = !suggested && name === request.name ? null : validateEntryName(name, current, siblings);

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.focus();
    // Select the part before the extension, like a file manager.
    const dot = request.directory ? -1 : request.name.lastIndexOf(".");
    element.setSelectionRange(0, dot > 0 ? dot : request.name.length);
  }, [request]);

  return (
    <div className="workbench-confirm-dialog__backdrop" role="presentation">
      <div className="workbench-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="zip-rename-title">
        <header className="workbench-confirm-dialog__header">
          <h2 id="zip-rename-title">{title}</h2>
          <button type="button" className="workbench-confirm-dialog__close" aria-label={tr("닫기")} onClick={onCancel}><Codicon name="close" /></button>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); if (!suggested && name === request.name) onCancel(); else if (!validateEntryName(name, current, siblings)) onSubmit(name.trim()); }}>
          <div className="workbench-confirm-dialog__body zip-extract-body">
            <input ref={input} className="zip-extract-password" value={name} spellCheck={false} aria-label={tr("새 이름")} aria-invalid={error !== null} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }} />
            {error ? <p className="zip-password-error" role="alert">{error}</p> : null}
          </div>
          <footer className="workbench-confirm-dialog__footer">
            <button type="button" className="workbench-confirm-dialog__button" onClick={onCancel}>{tr("취소")}</button>
            <button type="submit" className="workbench-confirm-dialog__button workbench-confirm-dialog__button--primary" disabled={error !== null || !name.trim()}>{tr("확인")}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
