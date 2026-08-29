import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useCloseOnAppBlur } from "@silk-studio/ui/hooks/useCloseOnAppBlur.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { ConnectionProfile } from "../../services/connection/connectionTypes";
import "./SearchConnectionPicker.css";

type MenuPosition = {
  top: number;
  left: number;
};

type SearchConnectionPickerProps = {
  profiles: ConnectionProfile[];
  /** `null` = every profile selected (see `SearchConnectionSelectionService`). */
  selection: Set<string> | null;
  anchorRef: RefObject<HTMLElement | null>;
  onChange: (selection: Set<string> | null) => void;
  onClose: () => void;
};

/**
 * Anchored popover for narrowing the Search sidebar to specific connections — modeled on
 * `ViewsVisibilityMenu` (same portal/positioning/outside-click/Escape/blur-close mechanics), but
 * multi-select: unlike that menu, clicking a row does NOT close the popover, since picking
 * several connections is the whole point.
 */
function SearchConnectionPicker({
  profiles,
  selection,
  anchorRef,
  onChange,
  onClose,
}: SearchConnectionPickerProps) {
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

  const allSelected = selection === null;

  function toggleProfile(id: string) {
    // Starting from "all" (selection === null), unchecking one profile means every *other*
    // profile stays selected — materialize the implicit full set, then remove just this one.
    const effective = selection ?? new Set(profiles.map((profile) => profile.id));
    const next = new Set(effective);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    // Back to every profile selected — collapse to the `null` sentinel so newly added
    // connections are included automatically, rather than freezing the current profile list.
    onChange(next.size === profiles.length ? null : next);
  }

  return createPortal(
    <div
      ref={rootRef}
      className="search-connection-picker"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      role="menu"
      aria-label={t("app.search.connectionsMenuAria")}
    >
      <button
        type="button"
        className={`search-connection-picker__item${allSelected ? " search-connection-picker__item--checked" : ""}`}
        role="menuitemcheckbox"
        aria-checked={allSelected}
        onClick={() => onChange(null)}
      >
        <span className="search-connection-picker__check" aria-hidden>
          {allSelected ? <Codicon name="check" /> : null}
        </span>
        <span className="search-connection-picker__label">
          {t("app.search.connectionsMenuAllLabel")}
        </span>
      </button>
      <div className="search-connection-picker__separator" role="separator" />
      {profiles.map((profile) => {
        const checked = allSelected || (selection?.has(profile.id) ?? false);
        return (
          <button
            key={profile.id}
            type="button"
            className={`search-connection-picker__item${checked ? " search-connection-picker__item--checked" : ""}`}
            role="menuitemcheckbox"
            aria-checked={checked}
            onClick={() => toggleProfile(profile.id)}
          >
            <span className="search-connection-picker__check" aria-hidden>
              {checked ? <Codicon name="check" /> : null}
            </span>
            <span className="search-connection-picker__label">{profile.name}</span>
            <span className="search-connection-picker__driver">{profile.driverId}</span>
          </button>
        );
      })}
      {profiles.length === 0 ? (
        <div className="search-connection-picker__empty">
          {t("app.search.connectionsMenuEmpty")}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

export default SearchConnectionPicker;
