import { describe, expect, it } from "vitest";
import { isDdlSourceAwaitingInitialLoad, shouldFetchInitialDdl } from "./ddlEditorConstants";

describe("shouldFetchInitialDdl", () => {
  it("fetches for a blank Object Editor buffer that has never loaded", () => {
    expect(shouldFetchInitialDdl("", "Loading...", false)).toBe(true);
    expect(shouldFetchInitialDdl(undefined, "Loading...", false)).toBe(true);
  });

  it("does not refetch a blank buffer once the tab has loaded", () => {
    expect(shouldFetchInitialDdl("", "Loading...", true)).toBe(false);
    expect(shouldFetchInitialDdl("CREATE VIEW v AS SELECT 1", "Loading...", false)).toBe(false);
  });
});

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
