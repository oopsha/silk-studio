import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { MetadataGroupId, MetadataObjectKind } from "@silk-studio/db-protocol";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useCloseOnAppBlur } from "@silk-studio/ui/hooks/useCloseOnAppBlur.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { getMetadataGroupDefinition } from "../../services/connection/metadataGroups";
import { ALL_SEARCH_KINDS } from "../../services/search/searchKindSelectionService";
import "./SearchKindPicker.css";

/** Reuses the Explorer group's own label/icon (`app.groups.*`) — same word, singular kind vs
 *  plural group id, e.g. "table" -> "tables" ("Tables"/"테이블"). */
const KIND_TO_GROUP_ID: Record<MetadataObjectKind, MetadataGroupId> = {
  table: "tables",
  view: "views",
  procedure: "procedures",
  function: "functions",
  package: "packages",
  trigger: "triggers",
  index: "indexes",
  sequence: "sequences",
  synonym: "synonyms",
  type: "types",
};

type MenuPosition = {
  top: number;
  left: number;
};

type SearchKindPickerProps = {
  selection: Set<MetadataObjectKind>;
  anchorRef: RefObject<HTMLElement | null>;
  onChange: (selection: Set<MetadataObjectKind>) => void;
  onClose: () => void;
};

/**
 * Anchored popover for restricting the Search sidebar to specific object kinds — same portal/
 * positioning/outside-click/Escape/blur-close mechanics as `SearchConnectionPicker`, and likewise
 * multi-select: clicking a row doesn't close the popover.
 */
function SearchKindPicker({ selection, anchorRef, onChange, onClose }: SearchKindPickerProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPosition({ top: Math.round(rect.bottom), left: Math.round(rect.left) });
  }, [anchorRef]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useEffect(() => {
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [updatePosition]);

  useEffect(() => {
    function handleScroll() {
      onClose();
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [onClose]);

  useEffect(() => {
    let listening = false;

    function handlePointerDown(event: PointerEvent) {
      if (!listening) return;
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const frameId = requestAnimationFrame(() => {
      listening = true;
    });

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose]);

  useCloseOnAppBlur(onClose);

  if (position === null) {
    return null;
  }

  const allSelected = selection.size === ALL_SEARCH_KINDS.length;

  function toggleKind(kind: MetadataObjectKind) {
    const next = new Set(selection);
    if (next.has(kind)) {
      next.delete(kind);
    } else {
      next.add(kind);
    }
    onChange(next);
  }

  function toggleAll() {
    onChange(allSelected ? new Set() : new Set(ALL_SEARCH_KINDS));
  }

  return createPortal(
    <div
      ref={rootRef}
      className="search-kind-picker"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      role="menu"
      aria-label={t("app.search.kindsMenuAria")}
    >
      <button
        type="button"
        className={`search-kind-picker__item${allSelected ? " search-kind-picker__item--checked" : ""}`}
        role="menuitemcheckbox"
        aria-checked={allSelected}
        onClick={toggleAll}
      >
        <span className="search-kind-picker__check" aria-hidden>
          {allSelected ? <Codicon name="check" /> : null}
        </span>
        <span className="search-kind-picker__label">{t("app.search.kindsMenuAllLabel")}</span>
      </button>
      <div className="search-kind-picker__separator" role="separator" />
      {ALL_SEARCH_KINDS.map((kind) => {
        const checked = selection.has(kind);
        const definition = getMetadataGroupDefinition(KIND_TO_GROUP_ID[kind]);
        return (
          <button
            key={kind}
            type="button"
            className={`search-kind-picker__item${checked ? " search-kind-picker__item--checked" : ""}`}
            role="menuitemcheckbox"
            aria-checked={checked}
            onClick={() => toggleKind(kind)}
          >
            <span className="search-kind-picker__check" aria-hidden>
              {checked ? <Codicon name="check" /> : null}
            </span>
            <span className="search-kind-picker__label">{definition.title}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export default SearchKindPicker;
