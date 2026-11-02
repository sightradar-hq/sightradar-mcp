<p align="center">
  <a href="https://sightradar.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.sightradar.com/brand/sightradar-logo-lockup-dark.png">
      <img src="https://assets.sightradar.com/brand/sightradar-logo-lockup.png" alt="SightRadar — Face Recognition API" width="360">
    </picture>
  </a>
</p>

<h1 align="center">SightRadar MCP Server</h1>

<p align="center">
  Face recognition for AI assistants. Index event photos, find every photo a person appears in from one selfie, run batches, manage webhooks and billing, all from Claude, ChatGPT, Cursor, VS Code or any <a href="https://modelcontextprotocol.io">MCP</a> client.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sightradar-mcp"><img src="https://img.shields.io/npm/v/sightradar-mcp?color=ff3b2f" alt="npm version"></a>
  <a href="https://github.com/sightradar-hq/sightradar-mcp/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/sightradar-mcp?color=1b1712" alt="License: MIT"></a>
  <a href="https://sightradar.com/docs"><img src="https://img.shields.io/badge/docs-sightradar.com-ffce4a" alt="Documentation"></a>
</p>

---

There are two ways to connect. Both expose the same tools.

| | Remote (hosted) | Local (this package) |
|---|---|---|
| URL / command | `https://mcp.sightradar.com/mcp` | `npx -y sightradar-mcp` |
| Sign-in | SightRadar account (email + password, Google or email link), or an API key as a Bearer token | `SIGHTRADAR_API_KEY` |
| Install | Nothing | Node.js 20+ |
| Images from your computer | No (URLs or base64) | Yes, `file_path` |

## Remote server (recommended)

Add `https://mcp.sightradar.com/mcp` as a custom connector. On first use your browser opens sightradar.com, you sign in and choose what the assistant may do. Each connection gets its own revocable key, listed under **API keys** as `MCP: <app name>`.

- **Claude** (claude.ai, Desktop): Settings → Connectors → Add custom connector → paste the URL.
- **ChatGPT**: Settings → Apps & Connectors → Create → paste the URL, authentication OAuth.
- **Claude Code**: `claude mcp add --transport http sightradar https://mcp.sightradar.com/mcp`
- **Cursor** (`~/.cursor/mcp.json`) / **VS Code** (`.vscode/mcp.json`, key `servers`):
  ```json
  { "mcpServers": { "sightradar": { "url": "https://mcp.sightradar.com/mcp" } } }
  ```

Prefer an API key? Send it as a header instead of signing in:

```json
{
  "mcpServers": {
    "sightradar": {
      "url": "https://mcp.sightradar.com/mcp",
      "headers": { "Authorization": "Bearer frs_your_key" }
    }
  }
}
```

## Local server

Create an API key at [sightradar.com/dashboard/keys](https://sightradar.com/dashboard/keys), then:

```json
{
  "mcpServers": {
    "sightradar": {
      "command": "npx",
      "args": ["-y", "sightradar-mcp"],
      "env": { "SIGHTRADAR_API_KEY": "frs_your_key" }
    }
  }
}
```

That block works in Claude Desktop (`claude_desktop_config.json`), Cursor, Windsurf, Cline and most clients. Claude Code:

```sh
claude mcp add sightradar --env SIGHTRADAR_API_KEY=frs_your_key -- npx -y sightradar-mcp
```

| Variable | Default | |
|---|---|---|
| `SIGHTRADAR_API_KEY` | (required) | API key |
| `SIGHTRADAR_SCOPES` | `read,search,write,delete` | Which tool groups to expose. `all` adds `account`; `read` gives a read-only server. |
| `SIGHTRADAR_FILE_ROOTS` | your home folder | Folders `file_path` may read (separated by `:` on macOS/Linux, `;` on Windows). `none` turns `file_path` off. |
| `SIGHTRADAR_BASE_URL` | `https://api.sightradar.com` | API base URL |
| `SIGHTRADAR_TIMEOUT_MS` | `120000` | Per-request timeout |
| `SIGHTRADAR_DEBUG` | unset | Log each tool call (no arguments or results) to stderr |

## Tools

Credits: 100,000 credits = US$1. Every billable tool states its price in its description, and accepts an `idempotency_key` so a retry is never charged twice.

**read** — free

| Tool | |
|---|---|
| `list_collections` | Collections with photo, face and selfie counts; search and paging |
| `get_collection` | One collection's status and counts (`verify` recounts from the vector store) |
| `get_deletion_status` | Progress of a collection deletion |
| `list_batches` / `get_batch` / `get_batch_photos` | Batch jobs, status (one or up to 5000 at once) and per-photo results |
| `list_webhooks` / `list_webhook_failures` | Webhook endpoints and dead-lettered deliveries |
| `get_balance` / `get_usage` | Credit balance; usage summary, daily series or storage |

**search** — spends credits, stores nothing

| Tool | Credits | |
|---|---|---|
| `search_faces` | 93 | Find every photo in a collection containing the person in a selfie (or an embedding) |
| `search_by_point_id` | 62 | Repeat a registered selfie's search without re-sending it |
| `detect_faces` | 93 | Faces, bounding boxes and quality in an image |
| `compare_faces` | 93 per image | Are two faces the same person? |

**write** — spends credits / stores data

| Tool | Credits | |
|---|---|---|
| `index_photo` | 93 | Store a photo's faces in a collection |
| `register_selfie` | 93 | Store a person's selfie; returns its point id and embedding |
| `submit_batch` | 62 per photo | Up to 1000 photo URLs, index or match, processed in the background |
| `requeue_failed_batch_photos` | 62 per photo | Retry failed batch photos (preview, then execute) |
| `create_collection` / `recreate_collection` | free | |
| `create_webhook` / `replay_webhook_failures` | free | Signed deliveries for batch and deletion events |

**delete** — free

| Tool | |
|---|---|
| `delete_collection` | Soft delete with a 7-day restore window by default; `immediate` or `compliance` erase permanently |
| `restore_collection` | Undo a soft delete |
| `delete_photo` / `restore_photo` | Remove or restore one photo's faces |
| `delete_webhook` | Stop deliveries to an endpoint |

**account** — free, off by default on the local server

| Tool | |
|---|---|
| `list_api_keys` / `create_api_key` / `revoke_api_key` | API keys |
| `get_profile` / `update_profile` | Name and organization |
| `get_billing_settings` / `update_auto_recharge` / `get_invoice` | Auto-recharge, orders and invoice PDFs |
| `get_notification_settings` / `update_notification_settings` / `manage_notification_recipient` | Email alerts and extra recipients |
| `list_team_members` | Organization members |

### Prompts and resources

Clients that show MCP prompts (Claude's "+" menu, `/` commands) get three ready-made workflows:

| Prompt | What it does |
|---|---|
| `find_person_in_event` | Checks the balance, searches a collection with a selfie and lists the matching photos |
| `index_event_photos` | Picks `index_photo` or `submit_batch` by photo count and states the cost before starting |
| `account_health` | Balance, recent usage, failed batch photos and failed webhook deliveries |

Resources: `sightradar://docs/pricing-and-limits` (credits per operation, rate limits, image and deletion limits) and `sightradar://collections/{collection_id}` (one collection's counts, needs the `read` scope).

### Images

Image tools take exactly one of:

- `image_url`: a public http(s) URL. SightRadar downloads it, so it must be reachable from the internet.
- `gcs_key`: an object key on the CDN configured for your account.
- `image_base64`: the bytes as base64 or a `data:` URL. The remote server accepts up to 10 MB; the local server up to 30 MB.
- `file_path` (local server only): a JPEG, PNG, WebP, GIF, BMP, TIFF or HEIC file inside `SIGHTRADAR_FILE_ROOTS`.

Files and base64 data are checked to be real images before anything is uploaded.

## Example prompts

- "Create a collection called `wedding-2026-10` and index every photo in ~/Pictures/wedding."
- "Here is a selfie of Priya: which photos in `wedding-2026-10` is she in?"
- "Submit these 600 photo URLs as a batch into `marathon-7` and tell me when it's done."
- "How many credits did I spend this week, and on what?"
- "Delete the `test-event` collection." (The assistant confirms first, and the delete can be undone for 7 days.)

## Safety

- Tools carry MCP annotations (`readOnlyHint`, `destructiveHint`), so clients can ask before destructive calls.
- Deletes are soft by default. Permanent erasure needs `immediate` or `compliance` to be set explicitly.
- Scopes limit what a connection can do. A `read`-only connection cannot spend credits or change data.
- The local server reads files only inside `SIGHTRADAR_FILE_ROOTS`, after resolving symlinks, and only image files.
- API errors come back as tool results with the error code, a hint and the request id, never as stack traces.

## Troubleshooting

| You see | Meaning |
|---|---|
| `401` / `unauthorized` | The API key was revoked or mistyped. Create a new one at [sightradar.com/dashboard/keys](https://sightradar.com/dashboard/keys); remote connections: reconnect. |
| `402` / `insufficient_credits` | Top up at [sightradar.com/dashboard/billing](https://sightradar.com/dashboard/billing). |
| `409` / `duplicate_request_already_processed` | That `idempotency_key` was already used and charged; the earlier call succeeded. |
| `file_path ... is outside the folders this server may read` | Add the folder to `SIGHTRADAR_FILE_ROOTS` (`:`-separated on macOS/Linux, `;` on Windows). |
| `429` | Over the per-key request rate (50 per second) or the account's in-flight cap. Wait and retry. |

## Development

```sh
npm install
npm test          # unit tests against a mocked API
npm run build
SIGHTRADAR_API_KEY=frs_... node scripts/smoke.mjs   # free live calls over stdio
```

`createSightRadarServer({ api, scopes })` and `TOOLS` are exported for embedding the same tools in another host.

## Links

- [SightRadar](https://sightradar.com) · [API docs](https://sightradar.com/docs) · [Pricing](https://sightradar.com/pricing)
- Node.js SDK: [`sightradar` on npm](https://www.npmjs.com/package/sightradar) · Python SDK: [`sightradar` on PyPI](https://pypi.org/project/sightradar/)

MIT licensed.
