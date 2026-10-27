// Live smoke test: spawns the built stdio server and makes FREE calls only.
//   SIGHTRADAR_API_KEY=frs_... node scripts/smoke.mjs
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("../dist/cli.js", import.meta.url).pathname],
  env: { ...process.env, SIGHTRADAR_SCOPES: process.env.SIGHTRADAR_SCOPES ?? "read" },
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`tools: ${tools.length} (${tools.map((t) => t.name).join(", ")})`);
let failed = 0;
for (const [name, args] of [
  ["get_balance", {}],
  ["list_collections", { limit: 3 }],
  ["list_batches", { limit: 2 }],
  ["list_webhooks", {}],
  ["get_usage", { days: 7 }],
  ["get_collection", { collection_id: "__smoke_does_not_exist__" }],
]) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  const expectError = name === "get_collection";
  const ok = expectError ? r.isError : !r.isError;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${text.replace(/\s+/g, " ").slice(0, 160)}`);
}
await client.close();
process.exit(failed ? 1 : 0);
