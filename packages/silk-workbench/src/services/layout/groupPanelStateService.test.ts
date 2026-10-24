import { describe, expect, it, vi } from "vitest";

vi.mock("@silk-studio/editor/services/editor/monacoModelPath.ts", () => ({
  disposeMonacoModelForTab: vi.fn(),
}));

import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import { GroupPanelStateService } from "./groupPanelStateService";

describe("GroupPanelStateService editor-specific sizing", () => {
  it("keeps query result panel sizes independent for each editor tab", () => {
    const groupId = EditorGroupsService.getFocusedGroupId();
    const firstEditorId = `test-editor-${crypto.randomUUID()}`;
    const secondEditorId = `test-editor-${crypto.randomUUID()}`;
    const firstEditorDefault = GroupPanelStateService.getState(
      groupId,
      firstEditorId,
    ).size;
    const secondEditorDefault = GroupPanelStateService.getState(
      groupId,
      secondEditorId,
    ).size;

    GroupPanelStateService.setPanelSize(
      groupId,
      firstEditorDefault + 48,
      firstEditorId,
    );

    expect(
      GroupPanelStateService.getState(groupId, firstEditorId).size,
    ).toBe(firstEditorDefault + 48);
    expect(
      GroupPanelStateService.getState(groupId, secondEditorId).size,
    ).toBe(secondEditorDefault);
  });
});
