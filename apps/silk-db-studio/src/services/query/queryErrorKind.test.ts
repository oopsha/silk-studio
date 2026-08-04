import { describe, expect, it } from "vitest";
import {
  classifyQueryError,
  resolveScriptQueryTimeoutSec,
} from "./queryErrorKind";

describe("classifyQueryError", () => {
  it("classifies SQL Server timeout-as-cancel wording as timeout", () => {
    expect(
      classifyQueryError(
        new Error(
          "The statement has been canceled because the timeout expired.",
        ),
      ),
    ).toBe("timeout");
    expect(
      classifyQueryError(new Error("The query has timed out.")),
    ).toBe("timeout");
  });

  it("classifies explicit user cancel as cancel", () => {
    expect(
      classifyQueryError(new Error("Query was cancelled")),
    ).toBe("cancel");
    expect(
      classifyQueryError(new Error("Statement cancelled by user")),
    ).toBe("cancel");
    expect(
      classifyQueryError(new Error("The query has been canceled.")),
    ).toBe("cancel");
  });

  it("does not treat object names containing cancel as user cancel", () => {
    expect(
      classifyQueryError(
        new Error("Invalid column name 'CANCEL_YN'."),
      ),
    ).toBe("other");
    expect(
      classifyQueryError(
        new Error(
          "키워드 'ELSE' 근처의 구문이 잘못되었습니다.",
        ),
      ),
    ).toBe("other");
  });

  it("classifies other failures as other", () => {
    expect(
      classifyQueryError(new Error("Invalid object name 'dbo.Missing'")),
    ).toBe("other");
  });
});

describe("resolveScriptQueryTimeoutSec", () => {
  it("keeps unlimited and floors short timeouts", () => {
    expect(resolveScriptQueryTimeoutSec(0)).toBe(0);
    expect(resolveScriptQueryTimeoutSec(30)).toBe(300);
    expect(resolveScriptQueryTimeoutSec(600)).toBe(600);
  });
});
