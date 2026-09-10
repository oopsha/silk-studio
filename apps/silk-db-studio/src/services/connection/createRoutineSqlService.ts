import type { CreateRoutineKind } from "./createRoutineSql";
import type { CreateTableTarget } from "./createTableSql";
import { openCreateRoutineDraft } from "./createRoutineDraftService";
import { openCreatePackageDraft } from "./createPackageDraftService";

/** Opens an editable, target-bound DDL draft for a new stored routine. */
export function openCreateRoutineSql(
  target: CreateTableTarget,
  kind: CreateRoutineKind,
): void {
  openCreateRoutineDraft(target, kind);
}

/** Opens one Oracle DDL draft containing both the package specification and body. */
export function openCreatePackageSql(target: CreateTableTarget): void {
  openCreatePackageDraft(target);
}
