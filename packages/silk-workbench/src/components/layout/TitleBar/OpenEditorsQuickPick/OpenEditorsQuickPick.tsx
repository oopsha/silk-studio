import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useCloseOnAppBlur } from "@silk-studio/ui/hooks/useCloseOnAppBlur.ts";
import { codiconForLanguage } from "@silk-studio/editor/services/editor/languageFromPath.ts";
import { useI18n } from "../../../../platform/i18n/useI18n";
import {
  placeOverSilkEditor,
  TITLEBAR_QUICK_PICK_CLASS,
} from "../../../../services/quickinput/titlebarQuickPickPlacement";
import { useOpenEditorsQuickPick } from "./openEditorsQuickPickContext";
import "./OpenEditorsQuickPick.css";

function OpenEditorsQuickPick() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState(false);
  const { t } = useI18n();
  const {
    open,
    filter,
    setFilter,
    filteredTabs,
    groupOrder,
    focusedIndex,
    setFocusedIndex,
    inputRef,
    close,
    selectTab,
    handleInputKeyDown,
  } = useOpenEditorsQuickPick();
  const showGroupHeaders = groupOrder.length > 1;

  useLayoutEffect(() => {
    if (!open) {
      document.documentElement.classList.remove(TITLEBAR_QUICK_PICK_CLASS);
      return;
    }

    const el = rootRef.current;
    if (!el) return;

    const place = () => {
      if (placeOverSilkEditor(el)) setPlaced(true);
    };

    // Measure while silk-editor is visible, then hide it (same as CommandPalette).
    place();
    document.documentElement.classList.add(TITLEBAR_QUICK_PICK_CLASS);
    place();

    function handleResize() {
      place();
    }
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      document.documentElement.classList.remove(TITLEBAR_QUICK_PICK_CLASS);
    };
  }, [open, filter, filteredTabs.length]);

  useEffect(() => {
    if (!open) {
      setPlaced(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      close();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open, close]);

  useCloseOnAppBlur(close, open);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      ref={rootRef}
      className="quick-input-widget"
      role="dialog"
      aria-modal="true"
      aria-label={t("workbench.sidebar.openEditorsAria")}
      style={{
        position: "fixed",
        opacity: placed ? 1 : 0,
        pointerEvents: placed ? "auto" : "none",
      }}
    >
      <div className="quick-input-header">
        <div className="quick-input-filter">
          <input
            ref={inputRef}
            type="text"
            className="quick-input-box"
            value={filter}
            spellCheck={false}
            autoComplete="off"
            aria-label={t("workbench.sidebar.openEditorsFilterAria")}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>
      </div>

      <div className="quick-input-list">
        {filteredTabs.length === 0 ? (
          <div className="quick-input-list__empty">
            {t("workbench.sidebar.noMatchingEditors")}
          </div>
        ) : (
          filteredTabs.map((tab, index) => {
            const isFocused = index === focusedIndex;
            const showHeader =
              showGroupHeaders &&
              (index === 0 || filteredTabs[index - 1]?.groupId !== tab.groupId);
            const groupIndex = groupOrder.indexOf(tab.groupId) + 1;

            return (
              <div key={tab.id}>
                {showHeader ? (
                  <div className="quick-input-list-group-header">
                    {t("workbench.sidebar.openEditorsGroup").replace(
                      "{n}",
                      String(groupIndex),
                    )}
                  </div>
                ) : null}
                <div
                  className={`quick-input-list-row${isFocused ? " quick-input-list-row--focused" : ""}`}
                  role="option"
                  aria-selected={isFocused}
                  title={tab.uri ?? tab.label}
                  onMouseEnter={() => setFocusedIndex(index)}
                  onClick={() => selectTab(tab.id, tab.groupId)}
                >
                  <div className="quick-input-list-entry">
                    <span className="quick-input-list-icon" aria-hidden>
                      <Codicon name={codiconForLanguage(tab.languageId)} />
                    </span>
                    <span
                      className={`quick-input-list-label${tab.isPreview ? " quick-input-list-label--preview" : ""}`}
                    >
                      {tab.label}
                    </span>
                    {tab.isDirty ? (
                      <span className="quick-input-list-dirty" aria-hidden />
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
}

export default OpenEditorsQuickPick;
