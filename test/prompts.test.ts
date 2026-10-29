import { describe, it, expect } from "vitest";
import { connect } from "./helpers.js";
import { PROMPTS } from "../src/prompts.js";
import { TOOLS } from "../src/tools/index.js";

const promptText = (r: { messages: Array<{ content: { type: string; text?: string } }> }) =>
  r.messages.map((m) => m.content.text ?? "").join("\n");

describe("prompts", () => {
  it("lists every prompt with its arguments when all scopes are granted", async () => {
    const { client } = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(PROMPTS.map((p) => p.name).sort());
    const find = prompts.find((p) => p.name === "find_person_in_event")!;
    expect(find.arguments?.find((a) => a.name === "collection_id")?.required).toBe(true);
    expect(find.arguments?.find((a) => a.name === "selfie")?.required).toBeFalsy();
  });

  it("only mentions tools that exist", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const p of PROMPTS) {
      const text = p.text({ collection_id: "c", photos: "x", selfie: "s", days: "3" });
      const verbs = /\b(?:get|list|search|index|submit|register|detect|compare|delete|restore|create)_[a-z_]+\b/g;
      for (const word of text.match(verbs) ?? []) expect(names, `${p.name} mentions ${word}`).toContain(word);
    }
  });

  it("hides prompts whose tools are outside the granted scopes", async () => {
    const { client } = await connect(undefined, { scopes: ["read"] });
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["account_health"]);
  });

  it("fills in the arguments", async () => {
    const { client, calls } = await connect();
    const r = await client.getPrompt({
      name: "find_person_in_event",
      arguments: { collection_id: "wedding-2026", selfie: "https://x.test/me.jpg" },
    });
    const text = promptText(r as never);
    expect(text).toContain('"wedding-2026"');
    expect(text).toContain("https://x.test/me.jpg");
    expect(text).toMatch(/search_faces/);
    expect(calls).toHaveLength(0);

    const idx = promptText(
      (await client.getPrompt({ name: "index_event_photos", arguments: { collection_id: "c", photos: "~/Pictures/ev" } })) as never,
    );
    expect(idx).toMatch(/submit_batch/);
    expect(idx).toMatch(/wait for my go-ahead/);

    const health = promptText((await client.getPrompt({ name: "account_health", arguments: {} })) as never);
    expect(health).toContain("days=7");
  });

  it("rejects a prompt call missing a required argument", async () => {
    const { client } = await connect();
    await expect(client.getPrompt({ name: "index_event_photos", arguments: { collection_id: "c" } })).rejects.toThrow();
  });
});
