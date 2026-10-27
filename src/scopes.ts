// Permission scopes. Every tool belongs to exactly one scope. The remote
// server maps OAuth scopes onto these one-to-one; the local server reads them
// from SIGHTRADAR_SCOPES.

export const SCOPES = {
  read: "Read collections, batches, webhooks, balance and usage (free)",
  search: "Search, detect and compare faces (spends credits, stores nothing)",
  write: "Create collections, index photos, register selfies, submit batches, add webhooks (spends credits)",
  delete: "Delete collections, photos and webhooks",
  account: "Manage API keys, profile, notifications, auto-recharge, orders and team",
} as const;

export type Scope = keyof typeof SCOPES;

export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

/** What a client gets when it does not ask for anything narrower. */
export const DEFAULT_SCOPES: Scope[] = ["read", "search", "write", "delete"];

export function isScope(value: string): value is Scope {
  return Object.prototype.hasOwnProperty.call(SCOPES, value);
}

/**
 * Parse a scope list such as "read,search" or "read search". `all` expands to
 * every scope and `read-only` to just `read`. Unknown names are reported, not
 * silently dropped, so a typo cannot quietly widen or narrow access.
 */
export function parseScopes(input: string | undefined | null): { scopes: Scope[]; unknown: string[] } {
  if (!input || !input.trim()) return { scopes: [...DEFAULT_SCOPES], unknown: [] };
  const out = new Set<Scope>();
  const unknown: string[] = [];
  for (const raw of input.split(/[\s,]+/)) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    if (name === "all" || name === "*") ALL_SCOPES.forEach((s) => out.add(s));
    else if (name === "read-only" || name === "readonly") out.add("read");
    else if (isScope(name)) out.add(name);
    else unknown.push(raw);
  }
  return { scopes: ALL_SCOPES.filter((s) => out.has(s)), unknown };
}
