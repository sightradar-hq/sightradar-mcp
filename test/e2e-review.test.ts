import { describe, expect, it } from "vitest";
import { connect, json, textOf } from "./helpers.js";

// Fixes from the 2026-11-02 end-to-end review of the MCP server.

describe("delete_collection erase confirmation (#3)", () => {
  const counts = (face_count: number, selfie_count = 0) => ({ collection_id: "c", status: "active", face_count, selfie_count, photo_count: 3 });

  it("refuses an immediate erase of a collection that holds faces without confirm_erase, and deletes nothing", async () => {
    const { client, calls } = await connect((req) => (req.method === "GET" ? json(counts(155, 1)) : json({ status: "deleting" }, 202)));
    const r = await client.callTool({ name: "delete_collection", arguments: { collection_id: "c", immediate: true } });
    expect(r.isError).toBe(true);
    const body = JSON.parse(textOf(r));
    expect(body.code).toBe("confirmation_required");
    expect(body.face_count).toBe(155);
    expect(body.selfie_count).toBe(1);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("does the same for compliance=true", async () => {
    const { client, calls } = await connect((req) => (req.method === "GET" ? json(counts(0, 2)) : json({}, 202)));
    const r = await client.callTool({ name: "delete_collection", arguments: { collection_id: "c", compliance: true } });
    expect(JSON.parse(textOf(r)).code).toBe("confirmation_required");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("erases once confirm_erase=true is given, without the extra lookup", async () => {
    const { client, calls } = await connect(() => json({ status: "deleting" }, 202));
    await client.callTool({ name: "delete_collection", arguments: { collection_id: "c", immediate: true, confirm_erase: true } });
    expect(calls.map((c) => c.method)).toEqual(["DELETE"]);
    expect(calls[0]!.url.searchParams.get("immediate")).toBe("true");
    expect(calls[0]!.url.searchParams.get("intent")).toBe("erase");
  });

  it("lets an immediate delete of a provably empty collection through", async () => {
    const { client, calls } = await connect((req) => (req.method === "GET" ? json(counts(0, 0)) : json({ status: "deleting" }, 202)));
    const r = await client.callTool({ name: "delete_collection", arguments: { collection_id: "c", immediate: true } });
    expect(r.isError).toBeFalsy();
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
  });

  it("fails safe when the counts cannot be read", async () => {
    const { client, calls } = await connect((req) => (req.method === "GET" ? json({ error: "boom" }, 500) : json({}, 202)));
    const r = await client.callTool({ name: "delete_collection", arguments: { collection_id: "c", immediate: true } });
    expect(JSON.parse(textOf(r)).code).toBe("confirmation_required");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("passes a missing collection to the API so it answers its own 404", async () => {
    const { client, calls } = await connect((req) =>
      req.method === "GET" ? json({ error: "collection not found" }, 404) : json({ error: "collection not found" }, 404),
    );
    const r = await client.callTool({ name: "delete_collection", arguments: { collection_id: "c", immediate: true } });
    expect(JSON.parse(textOf(r)).status).toBe(404);
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
  });

  it("leaves a plain soft delete alone (the API guards that itself)", async () => {
    const { client, calls } = await connect(() => json({ status: "deletion_pending" }, 202));
    await client.callTool({ name: "delete_collection", arguments: { collection_id: "c" } });
    expect(calls.map((c) => c.method)).toEqual(["DELETE"]);
  });
});

describe("non-JSON upstream errors (#8)", () => {
  const html = (status: number) =>
    new Response("<!DOCTYPE html>\n<html><head><title>App Platform failed to forward this request</title></head></html>", {
      status,
      headers: { "content-type": "text/html", "x-request-id": "rid-1" },
    });

  it("never passes an HTML error page to the assistant", async () => {
    const { client } = await connect(() => html(504));
    const r = await client.callTool({ name: "restore_photo", arguments: { collection_id: "c", photo_id: "p" } });
    expect(r.isError).toBe(true);
    const text = textOf(r);
    expect(text).not.toMatch(/<!DOCTYPE|<html/i);
    const body = JSON.parse(text);
    expect(body.code).toBe("upstream_unavailable");
    expect(body.status).toBe(504);
    expect(body.request_id).toBe("rid-1");
    expect(body.hint).toMatch(/idempotency_key/);
  });

  it("names a 4xx HTML page without the markup", async () => {
    const { client } = await connect(() => html(403));
    const body = JSON.parse(textOf(await client.callTool({ name: "get_balance", arguments: {} })));
    expect(body.error).toBe("SightRadar refused the request (HTTP 403).");
  });

  it("keeps a short plain-text error as it is", async () => {
    const { client } = await connect(() => new Response("bad gateway", { status: 502, headers: { "content-type": "text/plain" } }));
    const body = JSON.parse(textOf(await client.callTool({ name: "get_balance", arguments: {} })));
    expect(body.error).toBe("bad gateway");
  });
});

describe("path ids (#12)", () => {
  for (const bad of ["..", ".", "a/b", "a\\b", "a\u0000b"]) {
    it(`rejects collection_id ${JSON.stringify(bad)} before calling the API`, async () => {
      const { client, calls } = await connect();
      const r = await client.callTool({ name: "get_collection", arguments: { collection_id: bad } });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/collection_id must not/);
      expect(calls).toHaveLength(0);
    });
  }

  it("rejects photo_id '..' on delete_photo, which would otherwise reach the collection route", async () => {
    const { client, calls } = await connect();
    const r = await client.callTool({ name: "delete_photo", arguments: { collection_id: "c", photo_id: ".." } });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("still accepts ordinary and non-ASCII ids", async () => {
    const { client, calls } = await connect(() => json({ collection_id: "x" }));
    await client.callTool({ name: "get_collection", arguments: { collection_id: "événement-2026..final" } });
    expect(calls).toHaveLength(1);
  });
});

describe("request id (#15)", () => {
  it("reports a doubled X-Request-Id once", async () => {
    const { client } = await connect(() => json({ detected_face_count: 1 }, 200, { "x-request-id": "e3ae,e3ae", "x-credits-remaining": "100" }));
    const r = await client.callTool({ name: "detect_faces", arguments: { image_url: "https://x.test/a.jpg" } });
    expect((r.structuredContent as { _meta: { request_id: string } })._meta.request_id).toBe("e3ae");
  });

  it("keeps two different ids", async () => {
    const { client } = await connect(() => json({}, 200, { "x-request-id": "a, b" }));
    const r = await client.callTool({ name: "get_balance", arguments: {} });
    expect((r.structuredContent as { _meta: { request_id: string } })._meta.request_id).toBe("a,b");
  });
});

describe("descriptions (#4, #9, #17)", () => {
  it("says op=match results need a webhook, delete_photo answers true for unknown ids, and no fixed in-flight number", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const by = (n: string) => tools.find((t) => t.name === n)!.description!;
    expect(by("submit_batch")).toMatch(/op=match results .* only to a webhook/);
    expect(by("delete_photo")).toMatch(/never indexed, still answers deleted=true/);
    expect(by("delete_collection")).toMatch(/confirmation_required until confirm_erase=true/);
    const res = await client.readResource({ uri: "sightradar://docs/pricing-and-limits" });
    expect(JSON.stringify(res)).not.toMatch(/10 billable requests in flight/);
  });
});
