import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

describe("registry metadata", () => {
  it("server.json matches package.json", () => {
    const pkg = read("../package.json");
    const srv = read("../server.json");
    expect(srv.name).toBe(pkg.mcpName);
    expect(srv.version).toBe(pkg.version);
    expect(srv.packages[0].identifier).toBe(pkg.name);
    expect(srv.packages[0].version).toBe(pkg.version);
    expect(srv.description.length).toBeLessThanOrEqual(100);
  });
});
