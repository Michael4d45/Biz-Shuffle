---
name: dev-workflow
description: Runs TSBunShuffle dev servers, tests, typecheck, lint, format, and release workflows. Use when starting local dev, debugging CI, running tests, building admin/desktop/server, or packaging releases.
---

# Dev workflow

## Install & verify

```bash
bun install
bun run build:admin    # required before server/desktop admin UI
bun run typecheck
bun run lint
bun run knip
bun run format:check
bun test
```

## Local dev

| Goal                            | Command                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Headless server + browser admin | `bun run dev:server -- --data-dir ./data --host 127.0.0.1 --port 8080`                                        |
| Admin UI hot reload             | `bun run dev:admin` (React Compiler — see `admin-ui` skill)                                                   |
| Desktop (Electrobun)            | `bun run build:admin && bun run dev:desktop`                                                                  |
| CLI player                      | `bun run --filter @bizshuffle-bun/client-cli-app dev -- --join --name Player1 --server http://127.0.0.1:8080` |

Desktop smoke: `bun run smoke:desktop` → logs at `%USERPROFILE%\BizShuffle\logs\desktop-smoke.log`.

## Test subsets

```bash
bun test                                              # default CI subset
bun run test:contract
bun run test:e2e
bun run --filter @bizshuffle-bun/testing test:integration
```

Single file: `bun test packages/testing/src/integration/save-request.test.ts`

## Release

```bash
bun run build:release
bun run package:server
git tag v0.x.x && git push origin v0.x.x   # triggers release workflow
```

## Data dirs

- Dev ROMs: `data/roms/` in repo (also seeded to `%USERPROFILE%\BizShuffle\roms` on desktop when empty)
- Runtime state: `--data-dir` or desktop user data under `%USERPROFILE%\BizShuffle\`

## CI (`.github/workflows/ci.yml`)

Order: install → typecheck → lint → knip → format:check → build:admin → bun test
