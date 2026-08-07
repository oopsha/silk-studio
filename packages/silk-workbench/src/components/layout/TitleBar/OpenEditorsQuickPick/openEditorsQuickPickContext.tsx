import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { TabBarActionService } from "@silk-studio/editor/services/editor/tabBarActionService.ts";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import type { EditorGroupId } from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import type { EditorTab } from "@silk-studio/editor/services/editor/editorTypes.ts";

export const FILTER_PREFIX = "edt active ";

export type OpenEditorsQuickPickTab = EditorTab & { groupId: EditorGroupId };

type OpenEditorsQuickPickContextValue = {
  open: boolean;
  filter: string;
  setFilter: (value: string) => void;
  filteredTabs: OpenEditorsQuickPickTab[];
  /** Layout-ordered group ids (unfiltered) — used to number "Group N" headers stably. */
  groupOrder: EditorGroupId[];
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  close: () => void;
  selectTab: (tabId: string, groupId: EditorGroupId) => void;
  handleInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};

const OpenEditorsQuickPickContext =
  createContext<OpenEditorsQuickPickContextValue | null>(null);

function collectAllTabs(): OpenEditorsQuickPickTab[] {
  const result: OpenEditorsQuickPickTab[] = [];
  for (const groupId of EditorGroupsService.getGroupIds()) {
    for (const tab of EditorGroupsService.getGroup(groupId).getTabs()) {
      result.push({ ...tab, groupId });
    }
  }
  return result;
}

function filterTabs(
  tabs: readonly OpenEditorsQuickPickTab[],
  query: string,
): OpenEditorsQuickPickTab[] {
  const normalized = query.toLowerCase();
  const prefix = FILTER_PREFIX.toLowerCase();

  let search = normalized;
  if (normalized.startsWith(prefix)) {
    search = normalized.slice(prefix.length).trim();
  }

  if (!search) {
    return [...tabs];
  }

  return tabs.filter((tab) => tab.label.toLowerCase().includes(search));
}

export function OpenEditorsQuickPickProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(FILTER_PREFIX);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const [tabs, setTabs] = useState<OpenEditorsQuickPickTab[]>(() => collectAllTabs());
  useEffect(() => {
    return EditorGroupsService.onDidChangeAnyGroup(() => {
      setTabs(collectAllTabs());
    });
  }, []);
  const groupOrder = useMemo(() => EditorGroupsService.getGroupIds(), [tabs]);
  const activeTab = useActiveEditor();
  const filteredTabs = useMemo(
    () => filterTabs(tabs, filter),
    [tabs, filter],
  );

  const close = useCallback(() => {
    setOpen(false);
    setFilter(FILTER_PREFIX);
  }, []);

  const selectTab = useCallback(
    (tabId: string, groupId: EditorGroupId) => {
      EditorGroupsService.setFocusedGroup(groupId);
      EditorGroupsService.getGroup(groupId).setActiveTab(tabId);
      close();
    },
    [close],
  );

  useEffect(() => {
    return TabBarActionService.onRequestShowOpenEditors(() => {
      setFilter(FILTER_PREFIX);
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    const frameId = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(FILTER_PREFIX.length, FILTER_PREFIX.length);
    });

    return () => cancelAnimationFrame(frameId);
  }, [open]);

  useEffect(() => {
    const activeIndex = filteredTabs.findIndex((tab) => tab.id === activeTab?.id);
    setFocusedIndex(activeIndex >= 0 ? activeIndex : 0);
  }, [activeTab?.id, filteredTabs]);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (filteredTabs.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocusedIndex((index) => (index + 1) % filteredTabs.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedIndex(
          (index) => (index - 1 + filteredTabs.length) % filteredTabs.length,
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const tab = filteredTabs[focusedIndex];
        if (tab) {
          selectTab(tab.id, tab.groupId);
        }
      }
    },
    [close, filteredTabs, focusedIndex, selectTab],
  );

  const value = useMemo<OpenEditorsQuickPickContextValue>(
    () => ({
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
    }),
    [
      open,
      filter,
      filteredTabs,
      groupOrder,
      focusedIndex,
      close,
      selectTab,
      handleInputKeyDown,
    ],
  );

  return (
    <OpenEditorsQuickPickContext.Provider value={value}>
      {children}
    </OpenEditorsQuickPickContext.Provider>
  );
}

export function useOpenEditorsQuickPick(): OpenEditorsQuickPickContextValue {
  const context = useContext(OpenEditorsQuickPickContext);
  if (!context) {
    throw new Error(
      "useOpenEditorsQuickPick must be used within OpenEditorsQuickPickProvider",
    );
  }
  return context;
}

export function useOpenEditorsQuickPickOptional():
  | OpenEditorsQuickPickContextValue
  | null {
  return useContext(OpenEditorsQuickPickContext);
}
