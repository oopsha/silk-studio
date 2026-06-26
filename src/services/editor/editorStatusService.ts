type CursorPosition = {
  line: number;
  column: number;
};

type EditorStatusListener = () => void;

class EditorStatusServiceImpl {
  private cursorPosition: CursorPosition = { line: 1, column: 1 };
  private readonly listeners = new Set<EditorStatusListener>();

  getCursorPosition(): CursorPosition {
    return this.cursorPosition;
  }

  setCursorPosition(line: number, column: number): void {
    const nextLine = Math.max(1, Math.floor(line));
    const nextColumn = Math.max(1, Math.floor(column));
    if (
      this.cursorPosition.line === nextLine &&
      this.cursorPosition.column === nextColumn
    ) {
      return;
    }

    this.cursorPosition = { line: nextLine, column: nextColumn };
    this.fireDidChange();
  }

  resetCursorPosition(): void {
    this.setCursorPosition(1, 1);
  }

  onDidChange(listener: EditorStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const EditorStatusService = new EditorStatusServiceImpl();
