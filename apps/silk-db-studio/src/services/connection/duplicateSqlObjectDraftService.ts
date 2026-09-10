import { bridgeFetchObjectDdl } from "./connectionDdlBridge";
import { bridgeListMetadata } from "./connectionBridge";
import { openCreatePackageDraft } from "./createPackageDraftService";
import { openCreateRoutineDraft } from "./createRoutineDraftService";
import { suggestCopiedTableName } from "./createTableSql";
import { openCreateViewDraft } from "./createViewDraftService";
import type { ExplorerObjectRef } from "./explorerObjectActions";

type DuplicableKind = "view" | "procedure" | "function" | "package";

function groupId(kind: DuplicableKind): "views" | "procedures" | "functions" | "packages" {
  return `${kind}s` as "views" | "procedures" | "functions" | "packages";
}

function viewDefinition(ddl: string): string {
  const match = /\bAS\b([\s\S]*)/i.exec(ddl);
  if (!match) throw new Error("뷰 정의에서 SELECT 본문을 찾을 수 없습니다.");
  return match[1]
    .replace(/;\s*(?:COMMENT\s+ON|EXEC\s+sys\.sp_)[\s\S]*$/i, "")
    .replace(/;\s*$/, "")
    .trim();
}

/** Loads the same DDL used by the existing object editors and opens a populated creation draft. */
export async function openDuplicateSqlObjectDraft(ref: ExplorerObjectRef): Promise<void> {
  const kind = ref.object.kind;
  if (kind !== "view" && kind !== "procedure" && kind !== "function" && kind !== "package") {
    throw new Error("이 객체는 복제할 수 없습니다.");
  }
  const target = { profileId: ref.profileId, schemaName: ref.schemaName, catalogName: ref.catalogName };
  const metadata = await bridgeListMetadata(ref.profileId, ref.schemaName, ref.catalogName ?? undefined, false);
  const schema = metadata.schemas.find((item) => item.name.toLocaleLowerCase() === ref.schemaName.toLocaleLowerCase());
  const names = schema?.groups.find((group) => group.id === groupId(kind))?.objects.map((item) => item.name) ?? [];
  const copiedName = suggestCopiedTableName(ref.object.name, names);

  if (kind === "package") {
    const [spec, body] = await Promise.all([
      bridgeFetchObjectDdl(ref.profileId, ref.schemaName, ref.object.name, kind, false, ref.catalogName ?? undefined),
      bridgeFetchObjectDdl(ref.profileId, ref.schemaName, ref.object.name, kind, true, ref.catalogName ?? undefined),
    ]);
    openCreatePackageDraft(target, { name: copiedName, spec: spec.ddl, body: body.ddl, fullDefinition: true });
    return;
  }

  const source = await bridgeFetchObjectDdl(ref.profileId, ref.schemaName, ref.object.name, kind, undefined, ref.catalogName ?? undefined);
  if (kind === "view") {
    openCreateViewDraft(target, { viewName: copiedName, definition: viewDefinition(source.ddl) });
    return;
  }
  openCreateRoutineDraft(target, kind, { routineName: copiedName, body: source.ddl, fullDefinition: true });
}
