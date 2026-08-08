import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./normalize-email.js";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });

  it("folds plus-addressing", () => {
    expect(normalizeEmail("alice+billing@example.com")).toBe("alice@example.com");
  });

  it("keeps dots in the local part (provider-specific folding is out of scope)", () => {
    expect(normalizeEmail("a.lice@example.com")).toBe("a.lice@example.com");
  });

  it("rejects strings without a valid domain", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("@example.com")).toBeNull();
    expect(normalizeEmail("alice@")).toBeNull();
  });

  it("rejects a local part that folds to nothing", () => {
    expect(normalizeEmail("+tag@example.com")).toBeNull();
  });
});
