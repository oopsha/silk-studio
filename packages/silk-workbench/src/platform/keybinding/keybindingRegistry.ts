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

class KeybindingRegistryImpl {
  private readonly bindings = new Map<string, string[]>();
  private readonly commandSequences = new Map<string, KeyChord[][]>();
  private pendingSequence: KeyChord[] = [];
  private pendingTimeout: number | null = null;

  registerKeybinding(commandId: string, label: string): () => void {
    const current = this.bindings.get(commandId) ?? [];
    if (!current.includes(label)) {
      this.bindings.set(commandId, [...current, label]);
      this.addCommandSequence(commandId, parseKeybindingLabel(label));
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

  handleKeyboardEvent(event: KeyboardEvent): boolean {
    if (shouldIgnoreTarget(event.target)) {
      return false;
    }

    if (event.repeat) {
      return false;
    }

    const chord = keyboardEventToChord(event);
    const nextSequence = [...this.pendingSequence, chord];
    const matchedCommand = this.findMatchingCommand(nextSequence);

    if (!matchedCommand) {
      this.resetPendingSequence();
      return false;
    }

    const sequences = this.commandSequences.get(matchedCommand) ?? [];
    const isComplete = sequences.some((sequence) =>
      chordSequenceMatches(sequence, nextSequence),
    );

    if (!isComplete) {
      this.pendingSequence = nextSequence;
      this.resetPendingTimeout();
      event.preventDefault();
      return true;
    }

    if (
      NATIVE_CLIPBOARD_COMMANDS.has(matchedCommand) &&
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

  private findMatchingCommand(sequence: KeyChord[]): string | null {
    let matched: string | null = null;

    for (const [commandId, sequences] of this.commandSequences.entries()) {
      const matches = sequences.some((item) =>
        sequenceMatchesPrefix(item, sequence),
      );
      if (!matches) continue;
      if (matched) {
        return null;
      }
      matched = commandId;
    }

    return matched;
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
