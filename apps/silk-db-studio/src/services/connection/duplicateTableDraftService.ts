import {
  bridgeGetTableComment,
  bridgeListColumns,
  bridgeListMetadata,
} from "./connectionBridge";
import { bridgeListPrimaryKeys } from "./connectionPrimaryKeysBridge";
import { openCreateTableDraft } from "./createTableDraftService";
import {
  suggestCopiedTableName,
  type CreateTableColumnDraft,
} from "./createTableSql";
import type { ExplorerObjectRef } from "./explorerObjectActions";

/**
 * Opens the ordinary Create Table editor with the source table's column definition, primary-key
 * order and comments copied into a new draft. Indexes, foreign keys, triggers and data are
 * deliberately not copied: they need separate names and can create unintended dependencies.
 */
export async function openDuplicateTableDraft(ref: ExplorerObjectRef): Promise<void> {
  if (ref.object.kind !== "table") {
    throw new Error("Only tables can be duplicated.");
  }

  const catalog = ref.catalogName ?? undefined;
  const [columnsResult, primaryKeysResult, tableCommentResult, metadataResult] =
    await Promise.all([
      bridgeListColumns(ref.profileId, ref.schemaName, ref.object.name, catalog),
      bridgeListPrimaryKeys(ref.profileId, ref.schemaName, ref.object.name, catalog),
      bridgeGetTableComment(ref.profileId, ref.schemaName, ref.object.name, catalog).catch(
        () => ({ comment: undefined }),
      ),
      bridgeListMetadata(ref.profileId, ref.schemaName, catalog, false),
    ]);

  const keyOrder = new Map(
    primaryKeysResult.keys.map((key, index) => [
      key.name.toLocaleLowerCase(),
      index + 1,
    ]),
  );
  const columns: CreateTableColumnDraft[] = columnsResult.columns.map((column) => ({
    id: crypto.randomUUID(),
    name: column.name,
    typeName: column.typeName ?? "",
    length: column.columnSize,
    scale: column.decimalDigits,
    nullable: column.nullable ?? true,
    defaultValue: column.defaultValue,
    comment: column.comment,
    primaryKeyOrder: keyOrder.get(column.name.toLocaleLowerCase()),
  }));
  const schema = metadataResult.schemas.find(
    (entry) => entry.name.toLocaleLowerCase() === ref.schemaName.toLocaleLowerCase(),
  );
  const existingTableNames =
    schema?.groups.find((group) => group.id === "tables")?.objects.map((object) => object.name) ??
    [];

  openCreateTableDraft(
    {
      profileId: ref.profileId,
      schemaName: ref.schemaName,
      catalogName: ref.catalogName,
    },
    {
      tableName: suggestCopiedTableName(ref.object.name, existingTableNames),
      tableComment: tableCommentResult.comment,
      columns,
    },
  );
}
