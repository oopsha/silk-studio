import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./monacoModelPath", () => ({
  disposeMonacoModelForTab: vi.fn(),
}));

import { EditorGroupsService } from "./editorGroupsService";
import { EditorService } from "./editorServiceFacade";

describe("EditorService tab ownership", () => {
  let splitGroupId: ReturnType<typeof EditorGroupsService.getFocusedGroupId> | undefined;

  afterEach(() => {
    if (splitGroupId) {
      EditorGroupsService.closeGroup(splitGroupId);
      splitGroupId = undefined;
    }
  });

  it("routes tab-id updates to the owning group while another group is focused", () => {
    const sourceGroupId = EditorGroupsService.getFocusedGroupId();
    const sourceGroup = EditorGroupsService.getGroup(sourceGroupId);
    const sourceTab = sourceGroup.getActiveTab();
    if (!sourceTab) throw new Error("The source group should have an active tab.");

    splitGroupId = EditorGroupsService.splitGroup(sourceGroupId, "right");
    const splitGroup = EditorGroupsService.getGroup(splitGroupId);
    const splitTab = splitGroup.getActiveTab();
    if (!splitTab) throw new Error("The split group should have an active tab.");

    EditorGroupsService.setFocusedGroup(sourceGroupId);
    EditorService.updateTabContent(splitTab.id, "split group content");

    expect(EditorService.getTab(splitTab.id)?.content).toBe("split group content");
    expect(sourceGroup.findTab(sourceTab.id)?.content).not.toBe("split group content");

    splitGroup.markTabSaved(splitTab.id);
  });

  it("removes an emptied split group without leaving it focused or queryable", () => {
    const sourceGroupId = EditorGroupsService.getFocusedGroupId();
    splitGroupId = EditorGroupsService.splitGroup(sourceGroupId, "right");
    const splitGroup = EditorGroupsService.getGroup(splitGroupId);
    const splitTab = splitGroup.getActiveTab();
    if (!splitTab) throw new Error("The split group should have an active tab.");

    splitGroup.markTabSaved(splitTab.id);
    EditorGroupsService.closeTab(splitGroupId, splitTab.id);

    expect(EditorGroupsService.getGroupIfExists(splitGroupId)).toBeUndefined();
    expect(EditorGroupsService.getFocusedGroupId()).toBe(sourceGroupId);
    expect(EditorGroupsService.getGroupIds()).toEqual([sourceGroupId]);

    expect(() => EditorService.setActiveTextEditor(null, splitGroupId)).not.toThrow();
    expect(EditorService.getActiveTextEditor(splitGroupId)).toBeNull();
    expect(EditorService.getTabs(splitGroupId)).toEqual([]);
  });
});
