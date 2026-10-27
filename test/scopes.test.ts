import { describe, it, expect } from "vitest";
import { parseScopes, DEFAULT_SCOPES, ALL_SCOPES } from "../src/scopes.js";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/version.js";

describe("parseScopes", () => {
  it("defaults when empty", () => expect(parseScopes("").scopes).toEqual(DEFAULT_SCOPES));
  it("expands all", () => expect(parseScopes("all").scopes).toEqual(ALL_SCOPES));
  it("accepts commas and spaces, dedupes, keeps canonical order", () =>
    expect(parseScopes("write, read read").scopes).toEqual(["read", "write"]));
  it("reports unknown names", () => expect(parseScopes("read,admin").unknown).toEqual(["admin"]));
  it("read-only alias", () => expect(parseScopes("read-only").scopes).toEqual(["read"]));
});

describe("version", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});
