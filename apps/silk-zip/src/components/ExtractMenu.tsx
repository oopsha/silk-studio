import { useEffect, useRef, useState } from "react";
import { archiveStem, folderLabel, loadRecentFolders, type ExtractTarget } from "../extractTargets.ts";

export interface MenuAnchor { x: number; y: number }

export type ExtractScope = "selection" | "all";

interface ExtractMenuProps {
  archivePath: string;
  anchor: MenuAnchor;
  /** Label of the selected entries (e.g. "'a.txt'" or "3개 항목"); when set the menu also offers extracting just those. */
  selectionLabel?: string;
  onPick: (target: ExtractTarget, scope: ExtractScope) => void;
  /** When set, a "압축 파일 위치 열기" item is appended. */
  onRevealArchive?: () => void;
  /** When set, an "이름 바꾸기" item is added at the top (single selected entry). */
  onRename?: () => void;
  /** When set, a "압축 파일 테스트" item is added above it. */
  onTestArchive?: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 260;

/** Folder templates for extraction, shown as a popup at a screen position (button or right-click). */
export default function ExtractMenu({ archivePath, anchor, selectionLabel, onPick, onRevealArchive, onTestArchive, onRename, onClose }: ExtractMenuProps) {
  const [recent] = useState(loadRecentFolders);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);

  useEffect(() => {
    const height = menu.current?.offsetHeight ?? 0;
    setPosition({
      x: Math.max(4, Math.min(anchor.x, window.innerWidth - MENU_WIDTH - 4)),
      y: Math.max(4, Math.min(anchor.y, window.innerHeight - height - 4)),
    });
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [anchor]);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div className="zip-command-menu zip-command-menu--fixed" role="menu" ref={menu} style={{ left: position.x, top: position.y, width: MENU_WIDTH }}>
      {onRename ? (
        <>
          <button type="button" role="menuitem" onClick={onRename}><span>이름 바꾸기</span><kbd>F2</kbd></button>
          <div className="zip-command-menu__separator" role="separator" />
        </>
      ) : null}
      {selectionLabel ? (
        <>
          <div className="zip-command-menu__heading" title={selectionLabel}>{`선택한 ${selectionLabel} 풀기`}</div>
          <button type="button" role="menuitem" onClick={() => onPick("here", "selection")}><span>현재 폴더에 풀기</span></button>
          <button type="button" role="menuitem" onClick={() => onPick("ask", "selection")}><span>폴더 선택…</span></button>
          <div className="zip-command-menu__separator" role="separator" />
          <div className="zip-command-menu__heading">압축 파일 전체 풀기</div>
        </>
      ) : null}
      <button type="button" role="menuitem" onClick={() => onPick("named", "all")}><span>{`'${archiveStem(archivePath)}' 폴더에 풀기`}</span><kbd>Ctrl+Shift+S</kbd></button>
      <button type="button" role="menuitem" onClick={() => onPick("here", "all")}><span>현재 폴더에 풀기</span><kbd>Ctrl+Shift+C</kbd></button>
      <button type="button" role="menuitem" onClick={() => onPick("ask", "all")}><span>폴더 선택…</span><kbd>Ctrl+E</kbd></button>
      {recent.length ? (
        <>
          <div className="zip-command-menu__separator" role="separator" />
          <div className="zip-command-menu__heading">최근 사용한 폴더에 풀기</div>
          {recent.map((folder) => (
            <button type="button" role="menuitem" key={folder} title={folder} onClick={() => onPick({ dir: folder }, "all")}>
              <span>{folderLabel(folder)}</span>
            </button>
          ))}
        </>
      ) : null}
      {onRevealArchive ? (
        <>
          <div className="zip-command-menu__separator" role="separator" />
          {onTestArchive ? <button type="button" role="menuitem" onClick={onTestArchive}><span>압축 파일 테스트</span><kbd>Ctrl+T</kbd></button> : null}
          <button type="button" role="menuitem" onClick={onRevealArchive}><span>압축 파일 위치 열기</span></button>
        </>
      ) : null}
    </div>
  );
}
