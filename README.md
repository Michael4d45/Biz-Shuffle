# TSBunShuffle

**Bun + Electrobun** implementation of BizShuffle with **Effect Schema**, ports/adapters packages, and testable domain boundaries.

| Doc | Purpose |
|-----|---------|
| [BUN_ELECTROBUN_REWRITE_PROPOSAL.md](./BUN_ELECTROBUN_REWRITE_PROPOSAL.md) | Architecture and phases |
| [docs/SPEC.md](./docs/SPEC.md) | Product and technical specification |

## Artifacts

| Binary | Package |
|--------|---------|
| `BizShuffleServer` | `apps/server` |
| `BizShuffle` (desktop host) | `apps/desktop` |
| `bizshuffle-client` | `apps/client-cli` |

## Requirements

- [Bun](https://bun.sh) 1.1+
- Windows 11+ (Electrobun official target)

## Quick start

```bash
cd TSBunShuffle
bun install
bun run build:admin
bun test
```

### Headless server + browser admin

```bash
bun run dev:server -- --data-dir ./data --host 127.0.0.1 --port 8080
```

Open http://127.0.0.1:8080/

### Desktop app (Host / Join + admin window)

Runs via **Electrobun** (`electrobun dev`), not plain `bun run`:

```bash
bun run build:admin   # required once (copies SPA into server-host/priv/static)
bun run dev:desktop
```

- **Host** — starts embedded server and opens admin in a desktop window (not your browser).
- **Join** — connects as a player to a remote or discovered server.
- **Host & Play** / **Join** — checks **BizHawk** first; if missing, downloads the official release zip into `%USERPROFILE%\BizShuffle\BizHawk\` (no separate installer app required). Override with `bizhawk_path` in `config.json` or `BIZSHUFFLE_EMUHAWK_PATH`.

Use the browser admin only for **headless** `dev:server` (NAS, dedicated host machine, CI).

**Desktop smoke test** (launches app ~12s, checks lifecycle logs, exits):

```bash
bun run smoke:desktop
```

Logs: `%USERPROFILE%\BizShuffle\logs\desktop-smoke.log`. Electrobun has no built-in UI automation; use `smoke:desktop` for boot/render checks, or Playwright later if you bundle CEF.

### Dev client CLI

```bash
bun run --filter @bizshuffle-bun/client-cli-app dev -- --join --name Player1 --server http://127.0.0.1:8080
```

## Tests

```bash
bun test                          # protocol, domain, server-host, testing
bun test:contract                 # protocol matrix (WebSocket + HTTP)
bun test:e2e
```

## CI / releases

- **CI** (`.github/workflows/ci.yml`) — runs on pushes and PRs to `main`: `bun install`, `build:admin`, `bun test`.
- **Release** (`.github/workflows/release.yml`) — runs on version tags `v*` (e.g. `v0.2.0`): tests on Linux, then builds and uploads:
  - `bizshuffle-server-<version>-win-x64.zip` (compiled server + admin static)
  - Electrobun desktop artifacts from `apps/desktop/artifacts/`

Create a release:

```bash
git tag v0.2.0
git push origin v0.2.0
```

Set `BIZHAWK_PATH` for emulator integration tests.

## Package layout

- `@bizshuffle-bun/protocol` — Effect Schema types, codec, KV, game-mode helpers
- `@bizshuffle-bun/domain` — `ServerSession` (no I/O)
- `@bizshuffle-bun/ports` — port interfaces + Context tags
- `@bizshuffle-bun/adapters-bun` — Bun adapters (clock, etc.)
- `@bizshuffle-bun/server-host` — HTTP/WS server (Express on Bun runtime)
- `@bizshuffle-bun/client-host` — player runtime
- `@bizshuffle-bun/admin-ui` — React admin → `server-host/priv/static`
- `@bizshuffle-bun/testing` — contract, e2e, arch tests
