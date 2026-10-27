// Billable live check (~400 credits). Use a TEST account key only.
//   SIGHTRADAR_API_KEY=frs_... node scripts/smoke-billable.mjs <local-image> <image-url>
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { dirname } from "node:path";

const [file, url] = process.argv.slice(2);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("../dist/cli.js", import.meta.url).pathname],
  env: { ...process.env, SIGHTRADAR_SCOPES: "all", SIGHTRADAR_FILE_ROOTS: dirname(file) },
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);
const coll = `mcp-smoke-${Date.now()}`;
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  console.log(`${r.isError ? "ERR " : "ok  "} ${name}: ${r.content[0].text.replace(/\s+/g, " ").slice(0, 220)}`);
  return r;
};
await call("detect_faces", { file_path: file });
const idx = await call("index_photo", { collection_id: coll, photo_id: "p1", file_path: file, idempotency_key: `${coll}-i` });
await call("index_photo", { collection_id: coll, photo_id: "p2", image_url: url });
const pt = idx.structuredContent?.faces?.[0]?.point_id;
if (pt) await call("search_by_point_id", { collection_id: coll, point_id: pt });
await call("get_collection", { collection_id: coll });
await call("delete_collection", { collection_id: coll, immediate: true });
await call("get_deletion_status", { collection_id: coll });
await client.close();
