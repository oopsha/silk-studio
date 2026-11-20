import { useCallback, useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import type { ExtractTarget } from "../extractTargets.ts";
import ExtractMenu, { type MenuAnchor } from "./ExtractMenu.tsx";

interface CommandBarProps {
  archivePath: string | null;
  onOpen: () => void;
  onNew: () => void;
  onExtract: (target: ExtractTarget) => void;
}

/** Icon + label shortcuts under the menu bar (currently hidden by App); "풀기" is a split button. */
export default function CommandBar({ archivePath, onOpen, onNew, onExtract }: CommandBarProps) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const hasArchive = archivePath !== null;
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => { if (!hasArchive) setMenu(null); }, [hasArchive]);

  return (
    <div className="zip-command-bar" role="toolbar" aria-label="주요 명령">
      <button type="button" className="zip-command" onClick={onOpen} title="압축 파일 열기 (Ctrl+O)">
        <Codicon name="folder-opened" /><span>열기</span>
      </button>
      <button type="button" className="zip-command" onClick={onNew} title="새 압축 만들기 (Ctrl+N)">
        <Codicon name="new-file" /><span>새 압축</span>
      </button>
      <span className="zip-command-bar__separator" aria-hidden="true" />
      <div className="zip-command-split">
        <button type="button" className="zip-command" disabled={!hasArchive} onClick={() => onExtract("ask")} title="폴더를 골라 풀기 (Ctrl+E)">
          <Codicon name="export" /><span>풀기</span>
        </button>
        <button
          type="button"
          className="zip-command zip-command--arrow"
          disabled={!hasArchive}
          aria-label="풀기 옵션"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 2 }); }}
        >
          <Codicon name="chevron-down" />
        </button>
      </div>
      {menu && archivePath ? <ExtractMenu archivePath={archivePath} anchor={menu} onClose={closeMenu} onPick={(target) => { setMenu(null); onExtract(target); }} /> : null}
    </div>
  );
}
