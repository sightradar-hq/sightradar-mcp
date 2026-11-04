# Changelog

## Unreleased

- `delete_collection`: an `immediate` or `compliance` erase of a collection that still holds faces or selfies now answers `confirmation_required` until `confirm_erase=true`. The API skips its own confirmation for those flags, so one call could erase a full collection.
- Errors whose body is an HTML page (a proxy or CDN error) come back as `upstream_unavailable` with the status and request id, never as markup.
- `collection_id` and `photo_id` are checked before the call: `.`, `..`, `/`, `\` and control characters are refused with a clear message instead of a router 404.
- A doubled `X-Request-Id` (`a,a`) is reported once.
- Release workflow: npm publishing uses trusted publishing (OIDC) with an `NPM_TOKEN` fallback, and skips a version that is already on npm, so pushing a tag for the MCP Registry no longer fails the Publish job.
- Descriptions: `submit_batch` says `op=match` results reach only a webhook today; `delete_photo` says unknown ids still answer `deleted=true`; the limits text no longer promises a fixed in-flight number.

## 0.1.0

First release: 39 tools covering collections, face indexing and search, selfies, detect, compare, batches, webhooks, usage, API keys, profile, billing settings, invoices, notifications and team members. Three prompts (find_person_in_event, index_event_photos, account_health) and two resources (pricing and limits, collection by id). Local stdio server with API key auth, scopes and local file uploads.
