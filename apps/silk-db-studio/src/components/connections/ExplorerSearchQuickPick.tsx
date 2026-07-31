import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useCloseOnAppBlur } from "@silk-studio/ui/hooks/useCloseOnAppBlur.ts";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import {
  buildExplorerSearchPicks,
  type ExplorerSearchPick,
} from "../../services/connection/explorerSearchItems";
import { ExplorerSearchQuickPickService } from "../../services/connection/explorerSearchQuickPickService";
import {
  defaultObjectAction,
  EXPLORER_COMMANDS,
  type ExplorerObjectRef,
} from "../../services/connection/explorerObjectActions";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { useConnectionState } from "../../services/connection/useConnectionState";
import { useConnectionTree, getExplorerSchemas } from "../../services/connection/useConnectionTree";
import "@silk-studio/workbench/components/layout/TitleBar/OpenEditorsQuickPick/OpenEditorsQuickPick.css";
import "./ExplorerSearchQuickPick.css";

const QUICK_PICK_WIDTH = 520;

function ExplorerSearchQuickPick() {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => ExplorerSearchQuickPickService.isOpen());
  const [filter, setFilter] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busySchema, setBusySchema] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );

  const connection = useConnectionState();
  const profileId = connection.connectedProfileId;
  const tree = useConnectionTree(profileId);

  useEffect(() => {
    return ExplorerSearchQuickPickService.onDidChange(() => {
      const next = ExplorerSearchQuickPickService.isOpen();
      setOpen(next);
      if (next) {
        setFilter("");
        setFocusedIndex(0);
        setStatusMessage(null);
      }
    });
  }, []);

  const explorerSchemas = useMemo(
    () => getExplorerSchemas(tree),
    [tree],
  );

  const picks = useMemo(() => {
    if (!profileId || !open) return [] as ExplorerSearchPick[];
    return buildExplorerSearchPicks(profileId, explorerSchemas, filter);
  }, [profileId, explorerSchemas, filter, open]);

  useEffect(() => {
    setFocusedIndex((current) =>
      picks.length === 0 ? 0 : Math.min(current, picks.length - 1),
    );
  }, [picks]);

  const close = useCallback(() => {
    ExplorerSearchQuickPickService.hide();
  }, []);

  const updatePosition = useCallback(() => {
    const width = QUICK_PICK_WIDTH;
    const left = Math.max(12, Math.round((window.innerWidth - width) / 2));
    const top = Math.max(48, Math.round(window.innerHeight * 0.12));
    setPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition, picks.length]);

  useEffect(() => {
    if (!open) return;
    function handleResize() {
      updatePosition();
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const frameId = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open, close]);

  useCloseOnAppBlur(close, open);

  const acceptPick = useCallback(
    async (pick: ExplorerSearchPick, alternate: boolean) => {
      if (pick.type === "loadSchema") {
        setBusySchema(pick.schemaName);
        setStatusMessage(`Loading ${pick.schemaName}…`);
        try {
          await ConnectionTreeService.loadSchemaObjects(
            pick.profileId,
            pick.schemaName,
            true,
            tree.currentCatalog ?? undefined,
          );
          setStatusMessage(`Loaded ${pick.schemaName}. Continue typing to filter.`);
        } catch (error) {
          setStatusMessage(formatErrorMessage(error, t("app.explorer.searchLoadFailed")));
        } finally {
          setBusySchema(null);
          inputRef.current?.focus();
        }
        return;
      }

      const ref: ExplorerObjectRef = {
        profileId: pick.profileId,
        schemaName: pick.schemaName,
        object: pick.object,
      };
      const primary = defaultObjectAction(pick.object.kind);
      let commandId =
        primary === "openData"
          ? EXPLORER_COMMANDS.openData
          : EXPLORER_COMMANDS.viewDdl;

      if (alternate) {
        commandId =
          primary === "openData"
            ? EXPLORER_COMMANDS.viewDdl
            : pick.object.kind === "table" || pick.object.kind === "view"
              ? EXPLORER_COMMANDS.openData
              : EXPLORER_COMMANDS.viewDdl;
      }

      close();
      try {
        await CommandService.executeCommand(commandId, ref);
      } catch (error) {
        console.error("[silk.explorer.search]", error);
      }
    },
    [close, tree],
  );

  const handleInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (picks.length === 0) return;
      setFocusedIndex((index) => (index + 1) % picks.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (picks.length === 0) return;
      setFocusedIndex((index) => (index - 1 + picks.length) % picks.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const pick = picks[focusedIndex];
      if (!pick) return;
      void acceptPick(pick, event.ctrlKey || event.metaKey);
    }
  };

  if (!open) {
    return null;
  }

  const connected = Boolean(profileId) && ConnectionService.isConnected();
  const emptyHint = !connected
    ? t("app.explorer.searchNeedConnect")
    : tree.status === "loading"
      ? t("app.explorer.loadingSchemas")
      : explorerSchemas.length === 0
        ? t("app.explorer.searchNoSchemas")
        : filter.trim()
          ? t("app.explorer.searchNoMatch")
          : t("app.explorer.searchHint");

  return createPortal(
    <div
      ref={rootRef}
      className="quick-input-widget explorer-search-quick-pick"
      role="dialog"
      aria-label={t("app.explorer.searchTitle")}
      style={
        position
          ? {
              top: position.top,
              left: position.left,
              width: QUICK_PICK_WIDTH,
              position: "fixed",
            }
          : { visibility: "hidden", position: "fixed" }
      }
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
            placeholder={t("app.explorer.searchPlaceholder")}
            aria-label={t("app.explorer.searchAria")}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>
      </div>

      <div className="explorer-search-quick-pick__hint" role="note">
        Enter opens data/DDL · Ctrl+Enter opens the other action
      </div>

      <div className="quick-input-list" role="listbox">
        {picks.length === 0 ? (
          <div className="quick-input-list__empty">{emptyHint}</div>
        ) : (
          picks.map((pick, index) => {
            const isFocused = index === focusedIndex;
            const loading =
              pick.type === "loadSchema" && busySchema === pick.schemaName;
            return (
              <div
                key={pick.id}
                className={`quick-input-list-row${isFocused ? " quick-input-list-row--focused" : ""}`}
                role="option"
                aria-selected={isFocused}
                onMouseEnter={() => setFocusedIndex(index)}
                onClick={() => void acceptPick(pick, false)}
              >
                <div className="quick-input-list-entry">
                  <span className="quick-input-list-icon" aria-hidden>
                    <Codicon name={loading ? "loading" : pick.icon} />
                  </span>
                  <span className="quick-input-list-label">{pick.label}</span>
                  <span className="explorer-search-quick-pick__description">
                    {pick.description}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {statusMessage ? (
        <div className="explorer-search-quick-pick__status" role="status">
          {statusMessage}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

export default ExplorerSearchQuickPick;
