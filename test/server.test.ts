import { describe, it, expect } from "vitest";
import { connect, json, textOf } from "./helpers.js";
import { TOOLS } from "../src/tools/index.js";
import { ALL_SCOPES } from "../src/scopes.js";

describe("tool catalog", () => {
  it("has unique names, one scope each and a title", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(ALL_SCOPES).toContain(t.scope);
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(30);
      expect(t.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
    }
  });

  it("marks every billable tool's price in its description", () => {
    for (const t of TOOLS.filter((t) => t.billable)) {
      expect(t.description, t.name).toMatch(/credits/);
    }
  });

  it("only read-scope tools claim to be read-only", () => {
    for (const t of TOOLS) {
      if (t.annotations.readOnlyHint) expect(["read", "account"], t.name).toContain(t.scope);
      if (t.scope === "delete" && t.name.startsWith("delete")) expect(t.annotations.destructiveHint, t.name).toBe(true);
    }
  });
});

describe("listing", () => {
  it("lists every tool with input schemas and annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    const idx = tools.find((t) => t.name === "index_photo")!;
    expect(idx.inputSchema.type).toBe("object");
    expect(Object.keys(idx.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["collection_id", "image_url", "gcs_key", "image_base64"]),
    );
    // file_path is local-only
    expect(Object.keys(idx.inputSchema.properties ?? {})).not.toContain("file_path");
    expect(idx.annotations?.title).toBe("Index a photo");
  });

  it("hides tools outside the granted scopes", async () => {
    const { client } = await connect(undefined, { scopes: ["read"] });
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(5);
    for (const t of tools) expect(TOOLS.find((x) => x.name === t.name)!.scope).toBe("read");
    expect(tools.map((t) => t.name)).not.toContain("index_photo");
    expect(tools.map((t) => t.name)).not.toContain("create_api_key");
  });

  it("offers file_path when the host can read files", async () => {
    const { client } = await connect(undefined, {
      images: { readFile: async () => ({ bytes: new Uint8Array(), filename: "x" }), maxBase64Bytes: 1 },
    });
    const { tools } = await client.listTools();
    const idx = tools.find((t) => t.name === "index_photo")!;
    expect(Object.keys(idx.inputSchema.properties ?? {})).toContain("file_path");
  });
});

describe("calls", () => {
  it("sends the API key and returns structured content with credits", async () => {
    const { client, calls } = await connect(() =>
      json({ balance_credits: 12345 }, 200, { "x-credits-remaining": "12345" }),
    );
    const r = await client.callTool({ name: "get_balance", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer frs_testtest_secret");
    expect(calls[0]!.url.pathname).toBe("/v1/wallet");
    expect(r.structuredContent).toMatchObject({
      balance_credits: 12345,
      _meta: { credits_remaining: 12345, request_id: "req-test" },
    });
  });

  it("percent-encodes collection ids", async () => {
    const { client, calls } = await connect(() => json({}));
    await client.callTool({ name: "get_collection", arguments: { collection_id: "wedding 2026 é?#%" } });
    expect(calls[0]!.url.pathname).toBe("/v1/collections/wedding%202026%20%C3%A9%3F%23%25");
  });

  it("index_photo by URL posts JSON with photoId and the idempotency key", async () => {
    const { client, calls } = await connect(() => json({ indexed: 2 }));
    await client.callTool({
      name: "index_photo",
      arguments: { collection_id: "ev1", photo_id: "p1", image_url: "https://x.test/a.jpg", idempotency_key: "k1" },
    });
    const c = calls[0]!;
    expect(c.method).toBe("POST");
    expect(c.url.pathname).toBe("/v1/collections/ev1/index");
    expect(c.json).toEqual({ url: "https://x.test/a.jpg", photoId: "p1" });
    expect(c.headers.get("idempotency-key")).toBe("k1");
  });

  it("index_photo with base64 uploads multipart with the sniffed type", async () => {
    const { client, calls } = await connect(() => json({ indexed: 1 }));
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]).toString("base64");
    await client.callTool({
      name: "index_photo",
      arguments: { collection_id: "ev1", photo_id: "p9", image_base64: `data:image/jpeg;base64,${jpeg}`, override: true },
    });
    const c = calls[0]!;
    expect(c.url.search).toBe("?override=true");
    expect(c.form?.get("photoId")).toBe("p9");
    const file = c.form?.get("file") as File;
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(8);
  });

  it("refuses base64 that is not an image, without calling the API", async () => {
    const { client, calls } = await connect();
    const r = await client.callTool({
      name: "detect_faces",
      arguments: { image_base64: Buffer.from("#!/bin/sh\nrm -rf /").toString("base64") },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/supported image/);
    expect(calls).toHaveLength(0);
  });

  it("requires exactly one image source", async () => {
    const { client, calls } = await connect();
    const none = await client.callTool({ name: "detect_faces", arguments: {} });
    expect(none.isError).toBe(true);
    const two = await client.callTool({
      name: "detect_faces",
      arguments: { image_url: "https://x.test/a.jpg", gcs_key: "k" },
    });
    expect(two.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("search_faces with an embedding sends it as JSON", async () => {
    const { client, calls } = await connect(() => json({ matches: [] }));
    const embedding = Array.from({ length: 512 }, () => 0.01);
    await client.callTool({ name: "search_faces", arguments: { collection_id: "c", embedding, threshold: 0.5, limit: 3 } });
    expect(calls[0]!.json).toEqual({ embedding, threshold: 0.5, limit: 3 });
  });

  it("search_by_point_id sends pointId (not id)", async () => {
    const { client, calls } = await connect(() => json({ matches: [] }));
    await client.callTool({ name: "search_by_point_id", arguments: { collection_id: "c", point_id: "pt" } });
    expect(calls[0]!.json).toEqual({ pointId: "pt" });
  });

  it("register_selfie sends userId and selfieId", async () => {
    const { client, calls } = await connect(() => json({ face_found: true }));
    await client.callTool({
      name: "register_selfie",
      arguments: { collection_id: "c", user_id: "u1", selfie_id: "s1", gcs_key: "selfies/u1.jpg" },
    });
    expect(calls[0]!.json).toEqual({ gcsKey: "selfies/u1.jpg", userId: "u1", selfieId: "s1" });
  });

  it("compare_faces validates each side", async () => {
    const { client, calls } = await connect(() => json({ match: true }));
    const bad = await client.callTool({ name: "compare_faces", arguments: { source_url: "https://a.test/1.jpg" } });
    expect(bad.isError).toBe(true);
    await client.callTool({
      name: "compare_faces",
      arguments: { source_url: "https://a.test/1.jpg", target_gcs_key: "k2" },
    });
    expect(calls[0]!.json).toEqual({ sourceUrl: "https://a.test/1.jpg", targetGcsKey: "k2" });
  });

  it("delete_collection maps confirm_erase to intent=erase", async () => {
    const { client, calls } = await connect(() => json({ status: "deletion_pending" }, 202));
    await client.callTool({ name: "delete_collection", arguments: { collection_id: "c", confirm_erase: true } });
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url.searchParams.get("intent")).toBe("erase");
    expect(calls[0]!.url.searchParams.has("immediate")).toBe(false);
  });

  it("get_batch with many ids uses the statuses endpoint", async () => {
    const { client, calls } = await connect(() => json({ batches: [] }));
    const ids = ["7f1a5f0e-8c2b-4c55-9d7c-1b6a0c3f9e11", "1c0d7b8a-2e4f-4a6b-8c9d-0e1f2a3b4c5d"];
    await client.callTool({ name: "get_batch", arguments: { batch_ids: ids } });
    expect(calls[0]!.url.pathname).toBe("/v1/batches/statuses");
    expect(calls[0]!.json).toEqual({ batch_ids: ids });
  });

  it("update_notification_settings can disable the balance alert with null", async () => {
    const { client, calls } = await connect(() => json({}));
    await client.callTool({ name: "update_notification_settings", arguments: { disable_balance_alert: true } });
    expect(calls[0]!.json).toEqual({ balance_alert_threshold_credits: null });
  });

  it("update_profile sends only the fields given (the API keeps the rest)", async () => {
    const { client, calls } = await connect(() => json({}));
    await client.callTool({ name: "update_profile", arguments: { organization: "NewCo" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.json).toEqual({ organization: "NewCo" });
  });

  it("list_collections only accepts the statuses the API knows", async () => {
    const { client, calls } = await connect(() => json({ collections: [] }));
    const bad = await client.callTool({ name: "list_collections", arguments: { status: "archived" } });
    expect(bad.isError).toBe(true);
    await client.callTool({ name: "list_collections", arguments: { status: "deletion_pending", query: "wed" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get("status")).toBe("deletion_pending");
    expect(calls[0]!.url.searchParams.get("q")).toBe("wed");
  });
});

describe("errors", () => {
  it("turns API errors into isError results with code, hint and request id", async () => {
    const { client } = await connect(() =>
      json({ error: "insufficient credits", error_code: "insufficient_credits", error_detail: { code: "insufficient_credits", message: "Not enough credits" } }, 402),
    );
    const r = await client.callTool({ name: "detect_faces", arguments: { image_url: "https://x.test/a.jpg" } });
    expect(r.isError).toBe(true);
    const body = JSON.parse(textOf(r));
    expect(body).toMatchObject({ status: 402, code: "insufficient_credits", request_id: "req-test" });
    expect(body.error).toBe("Not enough credits");
    expect(body.hint).toMatch(/Top up/);
  });

  it("keeps useful structured error fields", async () => {
    const { client } = await connect(() =>
      json({ error: "below minimum", min_topup_credits: 500000 }, 400),
    );
    const r = await client.callTool({
      name: "update_auto_recharge",
      arguments: { enabled: true, threshold_credits: 1, recharge_credits: 1 },
    });
    expect(JSON.parse(textOf(r))).toMatchObject({ error: "below minimum", min_topup_credits: 500000 });
  });

  it("gives 429s without an error code a stable code and hint", async () => {
    const { client } = await connect(() => json({ error: "concurrency limit exceeded" }, 429));
    const r = await client.callTool({ name: "detect_faces", arguments: { image_url: "https://x.test/a.jpg" } });
    const body = JSON.parse(textOf(r));
    expect(body.code).toBe("concurrency_limit_exceeded");
    expect(body.hint).toMatch(/Too many requests at once/);
  });

  it("explains a settled idempotent replay", async () => {
    const { client } = await connect(() =>
      json({ error: "duplicate request already processed", error_code: "duplicate_request_already_processed" }, 409),
    );
    const r = await client.callTool({
      name: "index_photo",
      arguments: { collection_id: "c", image_url: "https://x.test/a.jpg", idempotency_key: "k" },
    });
    expect(JSON.parse(textOf(r)).hint).toMatch(/charged once/);
  });

  it("explains a confirmation_required delete", async () => {
    const { client } = await connect(() =>
      json({ error: "collection holds face data", code: "confirmation_required", face_count: 40 }, 409),
    );
    const r = await client.callTool({ name: "delete_collection", arguments: { collection_id: "c" } });
    const body = JSON.parse(textOf(r));
    expect(body.code).toBe("confirmation_required");
    expect(body.hint).toMatch(/confirm_erase=true/);
    expect(body.face_count).toBe(40);
  });

  it("reports network failures without throwing", async () => {
    const { client } = await connect(() => {
      throw new TypeError("fetch failed");
    });
    const r = await client.callTool({ name: "get_balance", arguments: {} });
    expect(r.isError).toBe(true);
    expect(JSON.parse(textOf(r)).code).toBe("network_error");
  });

  it("rejects bad arguments via the schema", async () => {
    const { client, calls } = await connect();
    const r = await client.callTool({ name: "list_collections", arguments: { limit: 100000 } });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("reports tool call events", async () => {
    const events: unknown[] = [];
    const { client } = await connect(() => json({}, 404), { onToolCall: (e) => events.push(e) });
    await client.callTool({ name: "get_collection", arguments: { collection_id: "nope" } });
    expect(events[0]).toMatchObject({ tool: "get_collection", scope: "read", ok: false, status: 404 });
  });

  it("truncates huge results and omits structured content", async () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({ photo_id: `photo-${i}`, score: 0.5 }));
    const { client } = await connect(() => json({ matches: big }));
    const r = await client.callTool({ name: "search_by_point_id", arguments: { collection_id: "c", point_id: "p" } });
    expect(textOf(r)).toMatch(/truncated/);
    expect(r.structuredContent).toBeUndefined();
  });
});
