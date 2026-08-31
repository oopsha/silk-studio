import { CommandService } from "../commands/commandService";
import {
  chordSequenceMatches,
  keyboardEventToChord,
  parseKeybindingLabel,
  type KeyChord,
} from "./keybindingLabels";

const CHORD_TIMEOUT_MS = 1000;

/**
 * Clipboard/undo commands where a widget's own native or library-level handling must win.
 * Monaco's hidden `<textarea class="inputarea">` and AG Grid's cell copy both rely on the
 * browser's *default* keydown action (native OS clipboard write, native undo/redo) — calling
 * `event.preventDefault()` and routing these through the workbench command service instead
 * (as happens for every other keybinding) silently breaks Ctrl+C/X/V/Z/Y inside those widgets.
 */
const NATIVE_CLIPBOARD_COMMANDS = new Set([
  "silk.edit.undo",
  "silk.edit.redo",
  "silk.edit.cut",
  "silk.edit.copy",
  "silk.edit.paste",
]);

/**
 * Edit/Selection menu commands that just call `editor.getAction(id).run()` on the focused
 * Monaco instance (see editActions.contribution.ts / selectionActions.contribution.ts).
 * Monaco registers the exact same default keybinding on itself, so while focus is inside
 * `.monaco-editor` we must back off here too — otherwise both this registry's global keydown
 * handler and Monaco's own internal one would fire, double-executing line-mutating actions
 * like Copy/Move Line or Add Cursor Above/Below.
 */
const NATIVE_EDITOR_ACTION_COMMANDS = new Set([
  "silk.edit.find",
  "silk.edit.replace",
  "silk.edit.toggleLineComment",
  "silk.edit.toggleBlockComment",
  "silk.selection.shrinkSelection",
  "silk.selection.expandSelection",
  "silk.selection.copyLineUp",
  "silk.selection.copyLineDown",
  "silk.selection.moveLineUp",
  "silk.selection.moveLineDown",
  "silk.selection.addCursorAbove",
  "silk.selection.addCursorBelow",
  "silk.selection.addCursorsToLineEnds",
  "silk.selection.addNextOccurrence",
  "silk.selection.selectAllOccurrences",
  "workbench.action.gotoLine",
]);

class KeybindingRegistryImpl {
  private readonly bindings = new Map<string, string[]>();
  /** Factory-default labels as registered by `*.contribution.ts` at startup — snapshotted the
   *  first time each command is seen, and never touched by `setBindings`. Lets the Keybindings
   *  editor offer "reset to default" after a user override changes `bindings`. */
  private readonly defaultBindings = new Map<string, string[]>();
  private readonly commandSequences = new Map<string, KeyChord[][]>();
  private readonly listeners = new Set<() => void>();
  private pendingSequence: KeyChord[] = [];
  private pendingTimeout: number | null = null;

  registerKeybinding(commandId: string, label: string): () => void {
    const current = this.bindings.get(commandId) ?? [];
    if (!current.includes(label)) {
      this.bindings.set(commandId, [...current, label]);
      const defaults = this.defaultBindings.get(commandId) ?? [];
      if (!defaults.includes(label)) {
        this.defaultBindings.set(commandId, [...defaults, label]);
      }
      this.addCommandSequence(commandId, parseKeybindingLabel(label));
      this.fireDidChange();
    }

    return () => {
      const next = (this.bindings.get(commandId) ?? []).filter(
        (key) => key !== label,
      );
      if (next.length > 0) {
        this.bindings.set(commandId, next);
      } else {
        this.bindings.delete(commandId);
      }
      this.rebuildCommandSequences(commandId);
      this.fireDidChange();
    };
  }

  lookupKeybinding(commandId: string): string | undefined {
    return this.bindings.get(commandId)?.[0];
  }

  getKeybindings(): ReadonlyArray<{ commandId: string; labels: readonly string[] }> {
    return [...this.bindings.entries()].map(([commandId, labels]) => ({
      commandId,
      labels: [...labels],
    }));
  }

  getDefaultKeybindings(commandId: string): string[] {
    return [...(this.defaultBindings.get(commandId) ?? [])];
  }

  /** Replaces `commandId`'s *active* key labels wholesale — used to apply/reset a user
   *  keybinding override. Leaves `defaultBindings` (the factory snapshot) untouched. */
  setBindings(commandId: string, labels: string[]): void {
    if (labels.length > 0) {
      this.bindings.set(commandId, [...labels]);
    } else {
      this.bindings.delete(commandId);
    }
    this.rebuildCommandSequences(commandId);
    this.fireDidChange();
  }

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  handleKeyboardEvent(event: KeyboardEvent): boolean {
    if (shouldIgnoreTarget(event.target)) {
      return false;
    }

    if (event.repeat) {
      return false;
    }

    const chord = keyboardEventToChord(event);
    const nextSequence = [...this.pendingSequence, chord];
    const { exact, pendingExists } = this.matchSequence(nextSequence);

    if (!exact && !pendingExists) {
      this.resetPendingSequence();
      return false;
    }

    if (!exact) {
      // A longer registered chord (e.g. "Ctrl+K Ctrl+S") still starts with what's been
      // pressed so far — hold the prefix and wait for the next key instead of firing yet.
      this.pendingSequence = nextSequence;
      this.resetPendingTimeout();
      event.preventDefault();
      return true;
    }

    const matchedCommand = exact;

    if (
      (NATIVE_CLIPBOARD_COMMANDS.has(matchedCommand) ||
        NATIVE_EDITOR_ACTION_COMMANDS.has(matchedCommand)) &&
      hasNativeClipboardHandling(event.target)
    ) {
      // Let the browser/Monaco/AG Grid handle this keydown natively instead of stealing it.
      this.resetPendingSequence();
      return false;
    }

    this.resetPendingSequence();
    event.preventDefault();
    void CommandService.executeCommand(matchedCommand);
    return true;
  }

  private addCommandSequence(commandId: string, sequence: KeyChord[]): void {
    const current = this.commandSequences.get(commandId) ?? [];
    const exists = current.some((item) =>
      chordSequenceMatches(item, sequence),
    );
    if (!exists) {
      this.commandSequences.set(commandId, [...current, sequence]);
    }
  }

  private rebuildCommandSequences(commandId: string): void {
    const labels = this.bindings.get(commandId) ?? [];
    if (labels.length === 0) {
      this.commandSequences.delete(commandId);
      return;
    }
    this.commandSequences.set(
      commandId,
      labels.map((label) => parseKeybindingLabel(label)),
    );
  }

  /**
   * `exact`: a command whose full registered sequence is satisfied by what's been pressed.
   * `pendingExists`: true when some *longer* registered sequence still starts with what's
   * been pressed — e.g. pressing just "Ctrl+K" while both "Ctrl+K W" and "Ctrl+K Ctrl+S" are
   * registered. Multiple commands sharing a chord prefix is normal (that's the whole point of
   * chords) and must not be treated as a conflict — only an exact-match collision (two
   * commands registered on the *same* full sequence) is ambiguous, and last-registered wins.
   */
  private matchSequence(sequence: KeyChord[]): {
    exact: string | null;
    pendingExists: boolean;
  } {
    let exact: string | null = null;
    let pendingExists = false;

    for (const [commandId, sequences] of this.commandSequences.entries()) {
      for (const registered of sequences) {
        if (!sequenceMatchesPrefix(registered, sequence)) continue;
        if (registered.length === sequence.length) {
          exact = commandId;
        } else {
          pendingExists = true;
        }
      }
    }

    return { exact, pendingExists };
  }

  private resetPendingSequence(): void {
    this.pendingSequence = [];
    this.resetPendingTimeout();
  }

  private resetPendingTimeout(): void {
    if (this.pendingTimeout !== null) {
      window.clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }

    if (this.pendingSequence.length === 0) {
      return;
    }

    this.pendingTimeout = window.setTimeout(() => {
      this.pendingSequence = [];
      this.pendingTimeout = null;
    }, CHORD_TIMEOUT_MS);
  }
}

function sequenceMatchesPrefix(
  expected: KeyChord[],
  pressed: KeyChord[],
): boolean {
  if (pressed.length > expected.length) return false;
  return expected
    .slice(0, pressed.length)
    .every((chord, index) => chord.ctrl === pressed[index].ctrl
      && chord.shift === pressed[index].shift
      && chord.alt === pressed[index].alt
      && chord.key === pressed[index].key);
}

function shouldIgnoreTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest(".monaco-editor")) {
    return false;
  }

  // The Keybindings editor's own key-capture box: it needs the raw keydown (including
  // shortcuts already bound elsewhere, e.g. Ctrl+S) to record a new binding, not to trigger
  // whatever command that combination currently runs.
  if (target.closest("[data-keybinding-capture]")) {
    return true;
  }

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  return target.isContentEditable;
}

/**
 * True when the event target sits inside a widget that implements its own native/library
 * clipboard or undo-redo handling (Monaco editor, AG Grid), which `shouldIgnoreTarget` above
 * otherwise routes through the global command dispatch (so shortcuts like Ctrl+S still work
 * while typing). See `NATIVE_CLIPBOARD_COMMANDS`.
 */
function hasNativeClipboardHandling(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(".monaco-editor") || target.closest(".ag-root-wrapper"),
  );
}

export const KeybindingsRegistry = new KeybindingRegistryImpl();
