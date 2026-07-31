import { describe, expect, it } from "vitest";
import { filterCommandPaletteItems } from "./commandCatalog";

describe("filterCommandPaletteItems", () => {
  const items = [
    { id: "workbench.action.openSettings", label: "Settings", keybinding: "Ctrl+," },
    { id: "silk.help.about", label: "About" },
    { id: "workbench.action.showCommands", label: "Command Palette...", keybinding: "Ctrl+Shift+P" },
  ];

  it("returns all items for empty query", () => {
    expect(filterCommandPaletteItems(items, "  ")).toHaveLength(3);
  });

  it("matches label, id, and keybinding", () => {
    expect(filterCommandPaletteItems(items, "about").map((i) => i.id)).toEqual([
      "silk.help.about",
    ]);
    expect(filterCommandPaletteItems(items, "openSettings").map((i) => i.id)).toEqual([
      "workbench.action.openSettings",
    ]);
    expect(filterCommandPaletteItems(items, "ctrl+shift+p").map((i) => i.id)).toEqual([
      "workbench.action.showCommands",
    ]);
  });
});
