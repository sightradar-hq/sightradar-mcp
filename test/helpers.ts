import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { SightRadarApi } from "../src/client.js";
import { createSightRadarServer, type CreateServerOptions } from "../src/server.js";

export interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  json?: unknown;
  form?: FormData;
}

export type Responder = (req: Recorded) => Response | Promise<Response>;

/** A fetch stub that records requests and answers from `respond`. */
export function mockFetch(respond: Responder = () => json({ ok: true })) {
  const calls: Recorded[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const rec: Recorded = { method: init?.method ?? "GET", url, headers };
    if (init?.body instanceof FormData) rec.form = init.body;
    else if (typeof init?.body === "string") rec.json = JSON.parse(init.body);
    calls.push(rec);
    return respond(rec);
  };
  return { calls, fetchImpl };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req-test", ...headers },
  });
}

export async function connect(
  respond?: Responder,
  opts: Partial<Omit<CreateServerOptions, "api">> = {},
) {
  const mock = mockFetch(respond);
  const api = new SightRadarApi({ apiKey: "frs_testtest_secret", baseUrl: "https://api.test", fetch: mock.fetchImpl });
  const server = createSightRadarServer({ api, ...opts });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientT);
  return { client, server, ...mock };
}

export function textOf(result: { content?: unknown }): string {
  const c = (result.content as Array<{ type: string; text?: string }>) ?? [];
  return c.filter((x) => x.type === "text").map((x) => x.text).join("\n");
}
