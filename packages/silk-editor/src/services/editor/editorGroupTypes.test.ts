import { describe, expect, it } from "vitest";
import {
  collectGroupIds,
  createInitialLayout,
  removeLeaf,
  resizeSplit,
  splitLeaf,
} from "./editorGroupTypes";

describe("editorGroupTypes", () => {
  it("createInitialLayout produces a single leaf", () => {
    const layout = createInitialLayout("group-a");
    expect(layout).toEqual({ type: "group", id: "group-a" });
    expect(collectGroupIds(layout)).toEqual(["group-a"]);
  });

  it("splitLeaf turns a leaf into a 2-child row split with even sizes", () => {
    const layout = createInitialLayout("group-a");
    const split = splitLeaf(layout, "group-a", "row", "group-b");

    expect(split.type).toBe("split");
    if (split.type !== "split") throw new Error("unreachable");
    expect(split.direction).toBe("row");
    expect(split.children).toEqual([
      { type: "group", id: "group-a" },
      { type: "group", id: "group-b" },
    ]);
    expect(split.sizes).toEqual([0.5, 0.5]);
    expect(collectGroupIds(split)).toEqual(["group-a", "group-b"]);
  });

  it("splitLeaf is a no-op when the target id is not found", () => {
    const layout = createInitialLayout("group-a");
    const result = splitLeaf(layout, "group-missing", "row", "group-b");
    expect(result).toBe(layout);
  });

  it("splitLeaf recurses into nested splits to find the target leaf", () => {
    const layout = createInitialLayout("group-a");
    const twoGroups = splitLeaf(layout, "group-a", "row", "group-b");
    const threeGroups = splitLeaf(twoGroups, "group-b", "column", "group-c");

    expect(collectGroupIds(threeGroups)).toEqual(["group-a", "group-b", "group-c"]);
  });

  it("removeLeaf collapses a 2-child split back into a single leaf", () => {
    const layout = createInitialLayout("group-a");
    const split = splitLeaf(layout, "group-a", "row", "group-b");

    const afterRemove = removeLeaf(split, "group-b");
    expect(afterRemove).toEqual({ type: "group", id: "group-a" });
  });

  it("removeLeaf returns null when removing the only remaining leaf", () => {
    const layout = createInitialLayout("group-a");
    expect(removeLeaf(layout, "group-a")).toBeNull();
  });

  it("removeLeaf renormalizes sibling sizes after removing one of three flat children", () => {
    // A hand-built flat 3-child row split (splitLeaf only ever produces
    // 2-child splits; nesting a 3rd would create a nested split instead —
    // this directly exercises removeLeaf's renormalization on a flat N-child split).
    const threeGroups = {
      type: "split" as const,
      id: "split-1",
      direction: "row" as const,
      children: [
        { type: "group" as const, id: "group-a" },
        { type: "group" as const, id: "group-b" },
        { type: "group" as const, id: "group-c" },
      ],
      sizes: [0.2, 0.3, 0.5],
    };

    const afterRemove = removeLeaf(threeGroups, "group-a");
    expect(afterRemove?.type).toBe("split");
    if (afterRemove?.type !== "split") throw new Error("unreachable");
    expect(collectGroupIds(afterRemove)).toEqual(["group-b", "group-c"]);
    const sum = afterRemove.sizes.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
    // Ratio between the two remaining siblings is preserved (0.3:0.5 renormalized).
    expect(afterRemove.sizes[0]).toBeCloseTo(0.3 / 0.8);
    expect(afterRemove.sizes[1]).toBeCloseTo(0.5 / 0.8);
  });

  it("splitLeaf on a leaf inside a split nests rather than flattening to N siblings", () => {
    const layout = createInitialLayout("group-a");
    const twoGroups = splitLeaf(layout, "group-a", "row", "group-b");
    const nested = splitLeaf(twoGroups, "group-b", "row", "group-c");

    if (nested.type !== "split") throw new Error("unreachable");
    expect(nested.children).toHaveLength(2);
    expect(nested.children[0]).toEqual({ type: "group", id: "group-a" });
    expect(nested.children[1]).toMatchObject({
      type: "split",
      children: [
        { type: "group", id: "group-b" },
        { type: "group", id: "group-c" },
      ],
    });
    expect(collectGroupIds(nested)).toEqual(["group-a", "group-b", "group-c"]);
  });

  it("resizeSplit updates only the matching split node's sizes", () => {
    const layout = createInitialLayout("group-a");
    const split = splitLeaf(layout, "group-a", "row", "group-b");
    if (split.type !== "split") throw new Error("unreachable");

    const resized = resizeSplit(split, split.id, [0.3, 0.7]);
    if (resized.type !== "split") throw new Error("unreachable");
    expect(resized.sizes).toEqual([0.3, 0.7]);

    const untouched = resizeSplit(split, "nonexistent-split-id", [0.1, 0.9]);
    expect(untouched).toEqual(split);
  });
});
