import { describe, expect, it } from "vitest";
import {
  bucketSortPrefix,
  capSuggestions,
  matchSortSuffix,
  MIN_SEARCH_ALL_CONNECTIONS_TERM_LENGTH,
} from "./sqlCompletionRanking";
import { completionBucketsForClause, wantsBucket } from "./sqlCompletionPolicy";
import type { SqlClause } from "./sqlCompletionClause";

describe("sqlCompletionRanking", () => {
  it("ranks columns above functions and routines in select_list / where", () => {
    expect(bucketSortPrefix("select_list", "columns") < bucketSortPrefix("select_list", "functions")).toBe(
      true,
    );
    expect(bucketSortPrefix("select_list", "functions") < bucketSortPrefix("select_list", "routines")).toBe(
      true,
    );
    expect(bucketSortPrefix("where", "columns") < bucketSortPrefix("where", "functions")).toBe(
      true,
    );
    expect(bucketSortPrefix("where", "functions") < bucketSortPrefix("where", "routines")).toBe(
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

describe("search-all-connections completion item", () => {
  const ALL_CLAUSES: SqlClause[] = [
    "statement_start",
    "select_list",
    "from",
    "join",
    "on",
    "where",
    "group_by",
    "having",
    "order_by",
    "insert",
    "values",
    "update",
    "set",
    "unknown",
  ];

  it("requires at least a 2-character term", () => {
    expect(MIN_SEARCH_ALL_CONNECTIONS_TERM_LENGTH).toBe(2);
  });

  it("sorts below every real suggestion's sortText, in every clause/bucket combination", () => {
    // Mirrors registerSqlCompletion.ts's `searchAllConnectionsSuggestion` sortText literal —
    // kept in sync manually since that function lives in a Monaco-dependent module this test
    // file can't import without a Monaco harness.
    const searchAllConnectionsSortText = "~zzz_searchAllConnections";
    for (const clause of ALL_CLAUSES) {
      for (const bucket of completionBucketsForClause(clause)) {
        const prefix = bucketSortPrefix(clause, bucket);
        // Any real item's sortText is `${prefix}_${matchSortSuffix(...)}`, e.g. "00_0_id" — even
        // the earliest-sorting one in this bucket must still be lexicographically less than ours.
        const earliestRealSortText = `${prefix}_0_`;
        expect(earliestRealSortText < searchAllConnectionsSortText).toBe(true);
      }
    }
  });
});
