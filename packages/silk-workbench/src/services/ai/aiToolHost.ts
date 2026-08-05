import type { AiToolDefinition, AiToolHostAdapter } from "./aiToolTypes";

const emptyAdapter: AiToolHostAdapter = {
  getTools: () => [],
  executeTool: async () =>
    JSON.stringify({ error: "Database tools are not configured." }),
};

let adapter: AiToolHostAdapter = emptyAdapter;

export function configureAiToolHost(next: AiToolHostAdapter): void {
  adapter = next;
}

export const AiToolHost = {
  getTools(): AiToolDefinition[] {
    try {
      return adapter.getTools();
    } catch {
      return [];
    }
  },
  executeTool(
    name: string,
    argsJson: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return adapter.executeTool(name, argsJson, signal);
  },
};
