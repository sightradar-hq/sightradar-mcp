import { describe, it, expect } from "vitest";
import { connect, json } from "./helpers.js";
import { PRICING_URI } from "../src/resources.js";

describe("resources", () => {
  it("lists the pricing document and the collection template", async () => {
    const { client } = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain(PRICING_URI);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("sightradar://collections/{collection_id}");
  });

  it("serves pricing markdown without calling the API", async () => {
    const { client, calls } = await connect();
    const r = await client.readResource({ uri: PRICING_URI });
    const text = (r.contents[0] as { text: string }).text;
    expect(text).toMatch(/100,000 credits = US\$1/);
    expect(text).toMatch(/index_photo \| 93/);
    expect(calls).toHaveLength(0);
  });

  it("reads a collection through the API with the id percent-encoded", async () => {
    const { client, calls } = await connect(() => json({ collection_id: "a b", face_count: 3 }));
    const r = await client.readResource({ uri: "sightradar://collections/a%20b" });
    expect(JSON.parse((r.contents[0] as { text: string }).text)).toMatchObject({ face_count: 3 });
    expect(calls[0]!.url.pathname).toBe("/v1/collections/a%20b");
  });

  it("has no collection template without the read scope", async () => {
    const { client } = await connect(undefined, { scopes: ["search"] });
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates).toHaveLength(0);
  });
});
