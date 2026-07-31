import { describe, expect, it } from "vitest";
import {
  bucketSortPrefix,
  capSuggestions,
  matchSortSuffix,
} from "./sqlCompletionRanking";
import { wantsBucket } from "./sqlCompletionPolicy";

describe("sqlCompletionRanking", () => {
  it("ranks columns above functions in select_list / where", () => {
    expect(bucketSortPrefix("select_list", "columns") < bucketSortPrefix("select_list", "functions")).toBe(
      true,
    );
    expect(bucketSortPrefix("where", "columns") < bucketSortPrefix("where", "functions")).toBe(
      true,
    );
  });

  it("ranks tables above schemas and keywords in from", () => {
    expect(bucketSortPrefix("from", "tables") < bucketSortPrefix("from", "schemas")).toBe(
      true,
    );
    expect(bucketSortPrefix("from", "tables") < bucketSortPrefix("from", "from_keywords")).toBe(
      true,
    );
  });

  it("caps long suggestion lists", () => {
    expect(capSuggestions([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
  });

  it("prefers exact / prefix matches in sort suffix", () => {
    expect(matchSortSuffix("id", "id") < matchSortSuffix("identity", "id")).toBe(
      true,
    );
    expect(matchSortSuffix("name", "na") < matchSortSuffix("xname", "")).toBe(
      true,
    );
  });
});

describe("completion policy after I-E order", () => {
  it("still excludes tables from select_list", () => {
    expect(wantsBucket("select_list", "tables")).toBe(false);
    expect(wantsBucket("select_list", "columns")).toBe(true);
  });
});
