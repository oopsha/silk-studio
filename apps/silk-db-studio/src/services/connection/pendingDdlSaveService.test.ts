import { describe, expect, it, vi } from "vitest";
import {
  discardPendingDdlSaves,
  registerPendingDdlSave,
  resolvePendingDdlSaves,
} from "./pendingDdlSaveService";

describe("pendingDdlSaveService", () => {
  it("resolves a single pending entry with onCommit on commit", () => {
    const onCommit = vi.fn();
    const onRollback = vi.fn();
    registerPendingDdlSave("conn1", { onCommit, onRollback });

    resolvePendingDdlSaves("conn1", "commit");

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onRollback).not.toHaveBeenCalled();
  });

  it("resolves a single pending entry with onRollback on rollback", () => {
    const onCommit = vi.fn();
    const onRollback = vi.fn();
    registerPendingDdlSave("conn1", { onCommit, onRollback });

    resolvePendingDdlSaves("conn1", "rollback");

    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("resolves multiple pending entries (FIFO) for the same connection in order", () => {
    const calls: string[] = [];
    registerPendingDdlSave("conn1", {
      onCommit: () => calls.push("first"),
      onRollback: () => calls.push("first-rollback"),
    });
    registerPendingDdlSave("conn1", {
      onCommit: () => calls.push("second"),
      onRollback: () => calls.push("second-rollback"),
    });

    resolvePendingDdlSaves("conn1", "commit");

    expect(calls).toEqual(["first", "second"]);
  });

  it("clears the list after resolving so a second resolve is a no-op", () => {
    const onCommit = vi.fn();
    registerPendingDdlSave("conn1", { onCommit, onRollback: vi.fn() });

    resolvePendingDdlSaves("conn1", "commit");
    resolvePendingDdlSaves("conn1", "commit");

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when nothing is pending for the connection", () => {
    expect(() => resolvePendingDdlSaves("nonexistent", "commit")).not.toThrow();
    expect(() => resolvePendingDdlSaves("nonexistent", "rollback")).not.toThrow();
  });

  it("only resolves entries for the given connectionId, not other connections", () => {
    const onCommitA = vi.fn();
    const onCommitB = vi.fn();
    registerPendingDdlSave("connA", { onCommit: onCommitA, onRollback: vi.fn() });
    registerPendingDdlSave("connB", { onCommit: onCommitB, onRollback: vi.fn() });

    resolvePendingDdlSaves("connA", "commit");

    expect(onCommitA).toHaveBeenCalledTimes(1);
    expect(onCommitB).not.toHaveBeenCalled();
  });

  it("discardPendingDdlSaves drops entries without invoking either callback", () => {
    const onCommit = vi.fn();
    const onRollback = vi.fn();
    registerPendingDdlSave("conn1", { onCommit, onRollback });

    discardPendingDdlSaves("conn1");

    expect(onCommit).not.toHaveBeenCalled();
    expect(onRollback).not.toHaveBeenCalled();

    // And a subsequent resolve finds nothing left to do.
    resolvePendingDdlSaves("conn1", "commit");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("discardPendingDdlSaves on a connection with nothing pending is a no-op", () => {
    expect(() => discardPendingDdlSaves("nonexistent")).not.toThrow();
  });
});
