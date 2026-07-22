export type KeyChord = {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
};

export function parseKeybindingLabel(label: string): KeyChord[] {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map(parseKeyChordPart);
}

function parseKeyChordPart(part: string): KeyChord {
  const tokens = part.split("+").map((token) => token.trim());
  let ctrl = false;
  let shift = false;
  let alt = false;
  let key = "";

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "ctrl" || lower === "control" || lower === "cmd") {
      ctrl = true;
      continue;
    }
    if (lower === "shift") {
      shift = true;
      continue;
    }
    if (lower === "alt" || lower === "option") {
      alt = true;
      continue;
    }
    key = normalizeKeyToken(token);
  }

  return { ctrl, shift, alt, key };
}

function normalizeKeyToken(token: string): string {
  if (token === ",") return ",";
  if (token === "`") return "`";
  if (token === "Enter") return "enter";
  if (token === "Escape") return "escape";
  if (token === "Backspace") return "backspace";
  if (token === "Delete") return "delete";
  if (token === "Tab") return "tab";
  if (token.length === 1) return token.toLowerCase();
  return token.toLowerCase();
}

export function keyboardEventToChord(event: KeyboardEvent): KeyChord {
  let key = event.key;

  if (key === " ") {
    key = "space";
  } else if (key.length === 1) {
    key = key.toLowerCase();
  } else {
    key = key.toLowerCase();
  }

  if (key === "arrowleft") key = "left";
  if (key === "arrowright") key = "right";
  if (key === "arrowup") key = "up";
  if (key === "arrowdown") key = "down";

  return {
    ctrl: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
    key,
  };
}

export function chordsEqual(left: KeyChord, right: KeyChord): boolean {
  return (
    left.ctrl === right.ctrl &&
    left.shift === right.shift &&
    left.alt === right.alt &&
    left.key === right.key
  );
}

export function chordSequenceMatches(
  sequence: KeyChord[],
  pressed: KeyChord[],
): boolean {
  if (pressed.length !== sequence.length) return false;
  return sequence.every((chord, index) => chordsEqual(chord, pressed[index]));
}

export function formatKeyChord(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("Ctrl");
  if (chord.shift) parts.push("Shift");
  if (chord.alt) parts.push("Alt");
  parts.push(chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return parts.join("+");
}
