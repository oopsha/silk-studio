export type EditorGroupId = string;
export type SplitDirection = "row" | "column";

export type EditorGroupNode = {
  type: "group";
  id: EditorGroupId;
};

export type EditorSplitNode = {
  type: "split";
  id: string;
  direction: SplitDirection;
  children: EditorLayoutNode[];
  /** Ratios in `children` order; sums to 1. */
  sizes: number[];
};

export type EditorLayoutNode = EditorGroupNode | EditorSplitNode;

function createSplitNodeId(): string {
  return `split-${crypto.randomUUID()}`;
}

export function createInitialLayout(groupId: EditorGroupId): EditorLayoutNode {
  return { type: "group", id: groupId };
}

export function collectGroupIds(node: EditorLayoutNode): EditorGroupId[] {
  if (node.type === "group") return [node.id];
  return node.children.flatMap(collectGroupIds);
}

/**
 * Splits the `targetId` leaf into a 2-child split node containing the
 * original leaf and a new leaf `newGroupId`. No-op (returns `root`
 * unchanged) if `targetId` is not found.
 */
export function splitLeaf(
  root: EditorLayoutNode,
  targetId: EditorGroupId,
  direction: SplitDirection,
  newGroupId: EditorGroupId,
): EditorLayoutNode {
  if (root.type === "group") {
    if (root.id !== targetId) return root;
    return {
      type: "split",
      id: createSplitNodeId(),
      direction,
      children: [root, { type: "group", id: newGroupId }],
      sizes: [0.5, 0.5],
    };
  }
  return {
    ...root,
    children: root.children.map((child) =>
      splitLeaf(child, targetId, direction, newGroupId),
    ),
  };
}

/**
 * Removes the `targetId` leaf. A split node left with a single child
 * collapses into that child. Returns `null` if the whole tree was removed
 * (only happens when `root` itself is the target leaf).
 */
export function removeLeaf(
  root: EditorLayoutNode,
  targetId: EditorGroupId,
): EditorLayoutNode | null {
  if (root.type === "group") {
    return root.id === targetId ? null : root;
  }

  const nextChildren: EditorLayoutNode[] = [];
  const nextSizes: number[] = [];
  root.children.forEach((child, index) => {
    if (child.type === "group" && child.id === targetId) return;
    const updated = removeLeaf(child, targetId);
    if (updated) {
      nextChildren.push(updated);
      nextSizes.push(root.sizes[index] ?? 1 / root.children.length);
    }
  });

  if (nextChildren.length === 0) return null;
  if (nextChildren.length === 1) return nextChildren[0]!;

  const sizeSum = nextSizes.reduce((sum, size) => sum + size, 0) || 1;
  return {
    ...root,
    children: nextChildren,
    sizes: nextSizes.map((size) => size / sizeSum),
  };
}

/** Updates the `sizes` of the split node identified by `splitId`. No-op if not found. */
export function resizeSplit(
  root: EditorLayoutNode,
  splitId: string,
  sizes: number[],
): EditorLayoutNode {
  if (root.type === "group") return root;
  if (root.id === splitId) return { ...root, sizes };
  return {
    ...root,
    children: root.children.map((child) => resizeSplit(child, splitId, sizes)),
  };
}
