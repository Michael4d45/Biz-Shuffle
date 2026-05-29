---
name: spec-and-contracts
description: Implements HTTP and WebSocket API changes per TSBunShuffle spec and contract docs. Use when adding endpoints, WS commands, protocol schemas, game modes, or updating docs/contracts.
---

# Spec & contracts

## Source of truth

1. `docs/SPEC.md` — full product/technical spec (implemented behavior)
2. `docs/contracts/` — focused contract slices

| Contract             | Topic                       |
| -------------------- | --------------------------- |
| `http-api.md`        | REST surface                |
| `ws-protocol.md`     | WS envelope, ack/nack, ping |
| `persistence.md`     | state.json, saves           |
| `lifecycle.md`       | session lifecycle           |
| `retry-semantics.md` | client retry behavior       |

## Change workflow

1. Read relevant SPEC section and contract file.
2. Add/update types in `packages/protocol/src/schemas.ts` (Effect Schema).
3. Implement server in `packages/server-host/src/http.ts` or `ws.ts`.
4. If player-visible, handle in `packages/client-host/src/controller.ts`.
5. If admin-visible, wire in `packages/admin-ui/src/` (HTTP only — no server-host imports).
6. Add test in `packages/testing/` (protocol matrix, admin-api, or integration).

## WS envelope

```json
{ "cmd": "<name>", "id": "<uuid>", "payload": {} }
```

Ack: `{ "cmd": "ack", "id": "<same>" }` or `nack` with `payload.reason`.

Command names: `CommandName` in `packages/protocol/src/schemas.ts`.

## Known spec gaps (don't re-implement without request)

- No `POST /api/reset`
- No player-name hashing for game assignment
- Player `fullscreen_toggle` / `check_config` / `update_config` are ack-only stubs
- `client-cli` does not launch BizHawk or run discovery

## Verification

```bash
bun run test:contract
bun test packages/testing/src/protocol/
bun test packages/testing/src/admin/
```
