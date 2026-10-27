#!/usr/bin/env node
// Local SightRadar MCP server over stdio.
//
//   SIGHTRADAR_API_KEY=frs_... npx -y sightradar-mcp
//
// Environment:
//   SIGHTRADAR_API_KEY     required; create one at https://sightradar.com/dashboard/keys
//   SIGHTRADAR_SCOPES      optional; e.g. "read,search" (default: read,search,write,delete; "all" adds account)
//   SIGHTRADAR_BASE_URL    optional; default https://api.sightradar.com
//   SIGHTRADAR_FILE_ROOTS  optional; folders file_path may read, separated by the OS path
//                          delimiter (default: your home directory); "none" disables file_path
//   SIGHTRADAR_TIMEOUT_MS  optional; per-request timeout (default 120000)

import { delimiter } from "node:path";
import { homedir } from "node:os";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { SightRadarApi, DEFAULT_BASE_URL } from "./client.js";
import { createSightRadarServer } from "./server.js";
import { parseScopes } from "./scopes.js";
import { createFileReader } from "./local-files.js";
import { MAX_IMAGE_BYTES } from "./images.js";
import { VERSION } from "./version.js";

const HELP = `sightradar-mcp ${VERSION}: SightRadar face recognition as an MCP server (stdio)

Usage:
  SIGHTRADAR_API_KEY=frs_... sightradar-mcp

Claude Desktop / Cursor config:
  {
    "mcpServers": {
      "sightradar": {
        "command": "npx",
        "args": ["-y", "sightradar-mcp"],
        "env": { "SIGHTRADAR_API_KEY": "frs_..." }
      }
    }
  }

Options (environment variables):
  SIGHTRADAR_API_KEY     API key (required). https://sightradar.com/dashboard/keys
  SIGHTRADAR_SCOPES      read, search, write, delete, account, all (default: read,search,write,delete)
  SIGHTRADAR_FILE_ROOTS  folders file_path may read (default: home directory; "none" to disable)
  SIGHTRADAR_BASE_URL    API base URL (default ${DEFAULT_BASE_URL})
  SIGHTRADAR_TIMEOUT_MS  request timeout in ms (default 120000)

Remote server with sign-in (no key needed): https://mcp.sightradar.com/mcp
`;

function fail(message: string): never {
  process.stderr.write(`sightradar-mcp: ${message}\n`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const apiKey = process.env.SIGHTRADAR_API_KEY?.trim();
  if (!apiKey) {
    fail("SIGHTRADAR_API_KEY is not set. Create a key at https://sightradar.com/dashboard/keys (run with --help for setup).");
  }

  const { scopes, unknown } = parseScopes(process.env.SIGHTRADAR_SCOPES);
  if (unknown.length) fail(`unknown SIGHTRADAR_SCOPES value(s): ${unknown.join(", ")}`);
  if (!scopes.length) fail("SIGHTRADAR_SCOPES selects no tools");

  const rootsEnv = process.env.SIGHTRADAR_FILE_ROOTS?.trim();
  const roots =
    rootsEnv === "none" ? [] : rootsEnv ? rootsEnv.split(delimiter).filter(Boolean) : [homedir()];

  const timeout = Number(process.env.SIGHTRADAR_TIMEOUT_MS);
  const api = new SightRadarApi({
    apiKey,
    baseUrl: process.env.SIGHTRADAR_BASE_URL?.trim() || DEFAULT_BASE_URL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
    userAgent: `sightradar-mcp/${VERSION} (local; node ${process.versions.node})`,
  });

  serveStdio(
    () =>
      createSightRadarServer({
        api,
        scopes,
        images: {
          readFile: roots.length ? createFileReader(roots) : undefined,
          // Local callers are not bound by a hosted model's context, so allow
          // uploads up to the API's own limit.
          maxBase64Bytes: MAX_IMAGE_BYTES,
        },
        onToolCall: process.env.SIGHTRADAR_DEBUG
          ? (e) => process.stderr.write(`sightradar-mcp: ${JSON.stringify(e)}\n`)
          : undefined,
      }),
    { onerror: (err) => process.stderr.write(`sightradar-mcp: ${err.message}\n`) },
  );
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
