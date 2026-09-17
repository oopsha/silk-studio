import { useEffect, useRef, useState } from "react";
import "./MaskedTemporalInput.css";

export type TemporalEditorKind = "date" | "time" | "datetime";

type MaskedTemporalInputProps = {
  kind: TemporalEditorKind;
  value: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  onChange: (value: string) => void;
};

/**
 * Fixed-slot temporal mask. Deleting `09` from the month leaves `__` in the month slot, so
 * the day and time digits never slide left and overwrite a different field.
 */
export function MaskedTemporalInput({
  kind,
  value,
  disabled = false,
  autoFocus = false,
  className,
  onChange,
}: MaskedTemporalInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mask = temporalMask(kind);
  const [maskedValue, setMaskedValue] = useState(() => maskValue(value ?? "", mask));
  const lastEmittedValueRef = useRef<string | null>(value);

  // Button actions in the value dialog (empty/NULL/current time) change the controlled value
  // from outside this input. Sync those changes, but do not reset the fixed slots after this
  // component's own keystrokes.
  useEffect(() => {
    if (value === lastEmittedValueRef.current) return;
    setMaskedValue(maskValue(value ?? "", temporalMask(kind)));
    lastEmittedValueRef.current = value;
  }, [kind, value]);

  useEffect(() => {
    if (!autoFocus) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const firstBlank = maskedValue.indexOf("_");
    input.setSelectionRange(firstBlank >= 0 ? firstBlank : mask.template.length, firstBlank >= 0 ? firstBlank : mask.template.length);
    // The editor is remounted for each cell/value-dialog target. Avoid re-running this while
    // typing, because that would reset a cursor the user deliberately moved into the month.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, kind]);

  const commit = (nextMaskedValue: string, caretPosition: number) => {
    setMaskedValue(nextMaskedValue);
    // An entirely cleared mask is an empty value, not a literal string of placeholders.
    const nextValue = /\d/.test(nextMaskedValue) ? nextMaskedValue : "";
    lastEmittedValueRef.current = nextValue;
    onChange(nextValue);
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input) input.setSelectionRange(caretPosition, caretPosition);
    });
  };

  return (
    <input
      ref={inputRef}
      className={className ? `masked-temporal-input ${className}` : "masked-temporal-input"}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      aria-label={temporalPlaceholder(kind)}
      value={maskedValue}
      disabled={disabled}
      onChange={() => {
        // Keyboard and paste are handled below so punctuation/placeholder characters never move.
      }}
      onKeyDown={(event) => {
        const input = event.currentTarget;
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? start;

        if (/^\d$/.test(event.key)) {
          event.preventDefault();
          const position = firstEditablePosition(mask, start);
          if (position == null) return;
          const next = replaceDigitSlots(maskedValue, mask, position, end, event.key);
          commit(next, nextEditablePosition(mask, position + 1));
          return;
        }
        if (event.key === "Backspace") {
          const position = start === end
            ? previousEditablePosition(mask, start)
            : firstEditablePosition(mask, start);
          if (position == null) return;
          event.preventDefault();
          commit(clearDigitSlots(maskedValue, mask, position, end), position);
          return;
        }
        if (event.key === "Delete") {
          const position = firstEditablePosition(mask, start);
          if (position == null) return;
          event.preventDefault();
          const clearEnd = start === end ? position + 1 : end;
          commit(clearDigitSlots(maskedValue, mask, position, clearEnd), position);
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const input = event.currentTarget;
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? start;
        const position = firstEditablePosition(mask, start);
        if (position == null) return;
        const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
        const next = replaceDigitSlots(maskedValue, mask, position, end, pasted);
        commit(next, nextEditablePosition(mask, position + pasted.length));
      }}
    />
  );
}

type TemporalMask = { template: string };

function temporalMask(kind: TemporalEditorKind): TemporalMask {
  if (kind === "date") return { template: "0000-00-00" };
  if (kind === "time") return { template: "00:00:00" };
  return { template: "0000-00-00 00:00:00" };
}

function maskValue(value: string, mask: TemporalMask): string {
  const digits = value.replace(/\D/g, "");
  let digitIndex = 0;
  return [...mask.template].map((character) => {
    if (character !== "0") return character;
    const digit = digits[digitIndex];
    digitIndex += 1;
    return digit ?? "_";
  }).join("");
}

function editablePositions(mask: TemporalMask, from = 0): number[] {
  return [...mask.template]
    .map((character, index) => character === "0" && index >= from ? index : -1)
    .filter((index) => index >= 0);
}

function firstEditablePosition(mask: TemporalMask, from: number): number | null {
  return editablePositions(mask, from)[0] ?? null;
}

function previousEditablePosition(mask: TemporalMask, from: number): number | null {
  return [...editablePositions(mask)].reverse().find((position) => position < from) ?? null;
}

function nextEditablePosition(mask: TemporalMask, from: number): number {
  return firstEditablePosition(mask, from) ?? mask.template.length;
}

function replaceDigitSlots(current: string, mask: TemporalMask, start: number, end: number, digits: string): string {
  const characters = [...current];
  const positions = editablePositions(mask, start);
  const selected = positions.filter((position) => position < end);
  const targets = selected.length > 0 ? selected : positions;
  for (let index = 0; index < digits.length && index < targets.length; index += 1) {
    characters[targets[index]] = digits[index];
  }
  return characters.join("");
}

function clearDigitSlots(current: string, mask: TemporalMask, start: number, end: number): string {
  const characters = [...current];
  const positions = editablePositions(mask, start).filter((position) => position < end || end === start);
  const targets = end === start ? positions.slice(0, 1) : positions;
  targets.forEach((position) => { characters[position] = "_"; });
  return characters.join("");
}

export function isCompleteTemporalValue(value: string, kind: TemporalEditorKind): boolean {
  if (value === "") return true;
  if (kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (kind === "time") return /^\d{2}:\d{2}:\d{2}$/.test(value);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
}

export function temporalPlaceholder(kind: TemporalEditorKind): string {
  if (kind === "date") return "YYYY-MM-DD";
  if (kind === "time") return "HH:mm:ss";
  return "YYYY-MM-DD HH:mm:ss";
}
