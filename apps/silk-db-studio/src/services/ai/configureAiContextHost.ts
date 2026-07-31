import { configureAiContextHost } from "@silk-studio/workbench/services/ai/aiContextHost.ts";
import { ConnectionService } from "../connection/connectionService";
import { ConnectionTreeService } from "../connection/connectionTreeService";
import { getConnectionDriver } from "../connection/connectionTypes";
import { QueryHistoryService } from "../query/queryHistoryService";

import { getExplorerSchemas } from "../connection/useConnectionTree";

const MAX_SCHEMAS = 30;
const MAX_OBJECTS_PER_GROUP = 40;

function truncate(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1))}…`;
}

function buildSchemaSummaryText(maxChars: number): string | null {
  const connected = ConnectionService.getConnectedProfile();
  if (!connected) return null;

  const cache = ConnectionTreeService.getCache(connected.id);
  const explorerSchemas = getExplorerSchemas(cache);
  if (cache.status === "idle" && explorerSchemas.length === 0) {
    return null;
  }

  const lines: string[] = [];
  if (cache.status === "error" && cache.errorMessage) {
    lines.push(`Explorer metadata error: ${cache.errorMessage}`);
  }
  if (cache.currentCatalog) {
    lines.push(`Current database: ${cache.currentCatalog}`);
  }

  const defaultSchema = connected.defaultSchema.trim().toLowerCase();
  const schemas = [...explorerSchemas].sort((a, b) => {
    const aDefault = a.name.toLowerCase() === defaultSchema ? 0 : 1;
    const bDefault = b.name.toLowerCase() === defaultSchema ? 0 : 1;
    if (aDefault !== bDefault) return aDefault - bDefault;
    return a.name.localeCompare(b.name);
  });

  const listed = schemas.slice(0, MAX_SCHEMAS);
  for (const schema of listed) {
    const marker =
      schema.name.toLowerCase() === defaultSchema ? " (default)" : "";
    lines.push(`Schema ${schema.name}${marker} [${schema.status}]`);

    if (schema.status !== "loaded" || schema.groups.length === 0) {
      continue;
    }

    for (const group of schema.groups) {
      if (group.objects.length === 0) continue;
      const names = group.objects
        .slice(0, MAX_OBJECTS_PER_GROUP)
        .map((object) => object.name);
      const more =
        group.objects.length > MAX_OBJECTS_PER_GROUP
          ? ` (+${group.objects.length - MAX_OBJECTS_PER_GROUP} more)`
          : "";
      lines.push(`  ${group.id}: ${names.join(", ")}${more}`);
    }
  }

  if (schemas.length > MAX_SCHEMAS) {
    lines.push(`… ${schemas.length - MAX_SCHEMAS} more schemas omitted`);
  }

  if (lines.length === 0) return null;
  return truncate(lines.join("\n"), maxChars);
}

function buildQueryHistoryText(
  maxChars: number,
  maxEntries: number,
): string | null {
  const entries = QueryHistoryService.getEntries().slice(0, maxEntries);
  if (entries.length === 0) return null;

  const blocks: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const sql = truncate(entry.sql.replace(/\s+/g, " "), 500);
    const header = `- [${entry.status}] ${entry.summary || "(no summary)"}`;
    const block = `${header}\n  ${sql}`;
    if (used + block.length + 1 > maxChars) break;
    blocks.push(block);
    used += block.length + 1;
  }

  return blocks.length > 0 ? blocks.join("\n") : null;
}

/** Wire DB Studio connection / Explorer / history into the workbench AI context host. */
export function configureDbStudioAiContextHost(): void {
  configureAiContextHost({
    getConnectionContext: () => {
      const state = ConnectionService.getState();
      const profile = ConnectionService.getConnectedProfile();
      if (!profile) {
        return { connected: false };
      }
      const driver = getConnectionDriver(profile.driverId);
      return {
        connected: state.status === "connected",
        profileName: profile.name,
        driverId: profile.driverId,
        dialectLabel: driver.label,
        catalog: profile.catalog,
        defaultSchema: profile.defaultSchema,
      };
    },
    getSchemaSummaryText: buildSchemaSummaryText,
    getRecentQueryHistoryText: buildQueryHistoryText,
  });
}
