import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useCloseOnAppBlur } from "@silk-studio/ui/hooks/useCloseOnAppBlur.ts";
import { CommandService } from "../../platform/commands/commandService";
import {
  filterCommandPaletteItems,
  listCommandPaletteItems,
  type CommandPaletteItem,
} from "../../services/commands/commandCatalog";
import { CommandPaletteService } from "../../services/commands/commandPaletteService";
import "../layout/TitleBar/OpenEditorsQuickPick/OpenEditorsQuickPick.css";
import "./CommandPalette.css";

const QUICK_PICK_WIDTH = 520;

function CommandPalette() {
  const [open, setOpen] = useState(() => CommandPaletteService.isOpen());
  const [filter, setFilter] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );

  useEffect(() => {
    return CommandPaletteService.onDidChange(() => {
      const next = CommandPaletteService.isOpen();
      setOpen(next);
      if (next) {
        setFilter("");
        setFocusedIndex(0);
      }
    });
  }, []);

  const items = useMemo(() => {
    if (!open) return [] as CommandPaletteItem[];
    return filterCommandPaletteItems(listCommandPaletteItems(), filter);
  }, [open, filter]);

  useEffect(() => {
    setFocusedIndex((current) =>
      items.length === 0 ? 0 : Math.min(current, items.length - 1),
    );
  }, [items]);

  const close = useCallback(() => {
    CommandPaletteService.hide();
  }, []);

  const updatePosition = useCallback(() => {
    const left = Math.max(12, Math.round((window.innerWidth - QUICK_PICK_WIDTH) / 2));
    const top = Math.max(48, Math.round(window.innerHeight * 0.12));
    setPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition, items.length]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => updatePosition();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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

  const accept = useCallback(
    async (item: CommandPaletteItem) => {
      close();
      if (item.id === "workbench.action.showCommands") return;
      try {
        await CommandService.executeCommand(item.id);
      } catch (error) {
        console.error("[commandPalette]", item.id, error);
      }
    },
    [close],
  );

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (items.length === 0) return;
      setFocusedIndex((index) => (index + 1) % items.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length === 0) return;
      setFocusedIndex((index) => (index - 1 + items.length) % items.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = items[focusedIndex];
      if (item) void accept(item);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={rootRef}
      className="quick-input-widget command-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      data-testid="command-palette"
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
            placeholder="Type a command name or id…"
            aria-label="Filter commands"
            aria-controls="command-palette-list"
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>
      </div>

      <div
        id="command-palette-list"
        className="quick-input-list"
        role="listbox"
        aria-label="Commands"
      >
        {items.length === 0 ? (
          <div className="quick-input-list__empty">No matching commands</div>
        ) : (
          items.map((item, index) => {
            const isFocused = index === focusedIndex;
            return (
              <div
                key={item.id}
                className={`quick-input-list-row${isFocused ? " quick-input-list-row--focused" : ""}`}
                role="option"
                aria-selected={isFocused}
                onMouseEnter={() => setFocusedIndex(index)}
                onClick={() => void accept(item)}
              >
                <div className="quick-input-list-entry">
                  <span className="quick-input-list-label">{item.label}</span>
                  <span className="command-palette__id">{item.id}</span>
                  {item.keybinding ? (
                    <span className="command-palette__keybinding">
                      {item.keybinding}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="command-palette__status" role="status" aria-live="polite">
        {items.length} command{items.length === 1 ? "" : "s"}
      </div>
    </div>,
    document.body,
  );
}

export default CommandPalette;
