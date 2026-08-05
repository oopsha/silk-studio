import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import {
  goToLogError,
  isModifiedClick,
  modifierClickLabel,
  type QueryLogLinkPart,
  type QueryLogPart,
} from "../../../services/query/queryLogNav";
import "./QueryResultLog.css";

type QueryResultLogProps = {
  parts: QueryLogPart[];
  plainText: string;
  className?: string;
};

type ContextMenuState = {
  x: number;
  y: number;
  link: QueryLogLinkPart | null;
};

function QueryResultLog({ parts, plainText, className }: QueryResultLogProps) {
  const { t } = useI18n();
  const preRef = useRef<HTMLPreElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const modifier = modifierClickLabel();
  const linkTitle = t("app.query.ctrlClickGoToError").replace(
    "{modifier}",
    modifier,
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu, closeMenu]);

  async function writeClipboard(text: string, successKey: "app.query.copiedLog" | "app.query.copiedErrorMessage" | "app.query.copiedFullError") {
    if (!text.trim()) {
      AppNotificationService.show(t("app.query.nothingToCopy"), "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      AppNotificationService.show(t(successKey), "success");
    } catch (error) {
      console.warn("[query-result-log] copy failed", error);
      AppNotificationService.show(t("app.query.copyFailed"), "error");
    }
  }

  async function copyLogSelectionOrAll() {
    const pre = preRef.current;
    const selection = window.getSelection();
    const selected =
      pre &&
      selection &&
      selection.rangeCount > 0 &&
      pre.contains(selection.anchorNode) &&
      !selection.isCollapsed
        ? selection.toString()
        : "";
    await writeClipboard(selected || plainText, "app.query.copiedLog");
  }

  function handleLogKeyDown(event: KeyboardEvent<HTMLPreElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c") {
      return;
    }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }
    event.preventDefault();
    void copyLogSelectionOrAll();
  }

  function handleContextMenu(event: MouseEvent<HTMLPreElement>) {
    event.preventDefault();
    const target = event.target as HTMLElement | null;
    const linkId = target?.closest?.("[data-log-link]")?.getAttribute(
      "data-log-link",
    );
    const links = parts.filter(
      (part): part is QueryLogLinkPart => part.kind === "link",
    );
    const fromTarget =
      linkId != null
        ? (parts.find(
            (part, index) =>
              part.kind === "link" && String(index) === linkId,
          ) as QueryLogLinkPart | undefined) ?? null
        : null;
    const link = fromTarget ?? (links.length === 1 ? links[0] : null);
    setMenu({ x: event.clientX, y: event.clientY, link });
  }

  function handleLinkClick(
    event: MouseEvent<HTMLSpanElement>,
    link: QueryLogLinkPart,
  ) {
    if (!isModifiedClick(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    goToLogError(link);
  }

  function handleLinkKeyDown(
    event: KeyboardEvent<HTMLSpanElement>,
    link: QueryLogLinkPart,
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    goToLogError(link);
  }

  const nodes: ReactNode[] = parts.map((part, index) => {
    if (part.kind === "text") {
      return <span key={`t-${index}`}>{part.text}</span>;
    }
    return (
      <span
        key={`l-${index}`}
        className="query-result-log__link"
        role="link"
        tabIndex={0}
        title={linkTitle}
        data-log-link={String(index)}
        onClick={(event) => handleLinkClick(event, part)}
        onKeyDown={(event) => handleLinkKeyDown(event, part)}
      >
        {part.text}
      </span>
    );
  });

  return (
    <>
      <pre
        ref={preRef}
        className={className}
        tabIndex={0}
        onKeyDown={handleLogKeyDown}
        onContextMenu={handleContextMenu}
      >
        {nodes}
      </pre>
      {menu ? (
        <div
          ref={menuRef}
          className="query-result-log__menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          {menu.link ? (
            <>
              <button
                type="button"
                className="query-result-log__menu-item"
                role="menuitem"
                onClick={() => {
                  goToLogError(menu.link!);
                  closeMenu();
                }}
              >
                {t("app.query.goToError")}
              </button>
              <button
                type="button"
                className="query-result-log__menu-item"
                role="menuitem"
                onClick={() => {
                  void writeClipboard(
                    menu.link!.message,
                    "app.query.copiedErrorMessage",
                  );
                  closeMenu();
                }}
              >
                {t("app.query.copyErrorMessage")}
              </button>
              <button
                type="button"
                className="query-result-log__menu-item"
                role="menuitem"
                onClick={() => {
                  void writeClipboard(
                    menu.link!.fullText,
                    "app.query.copiedFullError",
                  );
                  closeMenu();
                }}
              >
                {t("app.query.copyFullError")}
              </button>
              <div className="query-result-log__menu-sep" />
            </>
          ) : null}
          <button
            type="button"
            className="query-result-log__menu-item"
            role="menuitem"
            onClick={() => {
              void copyLogSelectionOrAll();
              closeMenu();
            }}
          >
            {t("app.query.copyLog")}
          </button>
        </div>
      ) : null}
    </>
  );
}

export default QueryResultLog;
