import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";

CommandsRegistry.registerCommand(
  "silk.file.newTextFile",
  () => EditorService.openUntitled(),
  { replace: true, titleKey: "studio.be.commands.newFile" },
);
