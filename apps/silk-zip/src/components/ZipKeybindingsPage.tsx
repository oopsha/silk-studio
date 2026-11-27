import KeybindingsEditor from "@silk-studio/workbench/components/keybindings/index.ts";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { setPage } from "../zipSettings";
import { tr } from "../i18n";

/** Shared keyboard shortcuts editor; replaces the workbench area while open. */
export default function ZipKeybindingsPage() {
  return (
    <div className="zip-settings-view">
      <button type="button" className="zip-settings-view__close" title={tr("닫기 (Esc)")} aria-label={tr("키보드 단축키 닫기")} onClick={() => setPage(null)}>
        <Codicon name="close" />
      </button>
      <KeybindingsEditor />
    </div>
  );
}
