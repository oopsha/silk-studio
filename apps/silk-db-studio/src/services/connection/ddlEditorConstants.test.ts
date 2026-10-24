import { describe, expect, it } from "vitest";
import { isDdlSourceAwaitingInitialLoad } from "./ddlEditorConstants";

describe("isDdlSourceAwaitingInitialLoad", () => {
  it("requests the initial load for missing content and loading placeholders", () => {
    expect(isDdlSourceAwaitingInitialLoad(undefined, "Loading...")).toBe(true);
    expect(isDdlSourceAwaitingInitialLoad("-- Loading DDL...\n", "Loading...")).toBe(true);
    expect(isDdlSourceAwaitingInitialLoad("-- Loading...\n", "Loading...")).toBe(true);
  });

  it("does not reload a cleared editor or a previous load failure", () => {
    expect(isDdlSourceAwaitingInitialLoad("", "Loading...")).toBe(false);
    expect(isDdlSourceAwaitingInitialLoad("   ", "Loading...")).toBe(false);
    expect(isDdlSourceAwaitingInitialLoad("-- Could not load DDL\n", "Loading...")).toBe(false);
    expect(isDdlSourceAwaitingInitialLoad("CREATE PROCEDURE p AS ...", "Loading...")).toBe(false);
  });
});
