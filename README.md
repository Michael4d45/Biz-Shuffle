# BizShuffle

Multiplayer save-state shuffle for BizHawk — Bun monorepo with a headless server, Electrobun desktop app, and CLI client.

**Spec:** [docs/SPEC.md](./docs/SPEC.md)

## Requirements

- [Bun](https://bun.sh) 1.3+ (see `.bun-version`)

## Setup

```bash
bun install
bun run build:admin
```

## Run

**Browser admin + server** (dedicated host, NAS, etc.):

```bash
bun run dev:server -- --data-dir ./data --host 127.0.0.1 --port 8080
```

Open http://127.0.0.1:8080/

**Desktop app** (Host, Join, Host & Play):

```bash
bun run dev:desktop
```

BizHawk is downloaded on first Host & Play if needed (`%USERPROFILE%\BizShuffle\BizHawk\`). Override with `bizhawk_path` in config or `BIZSHUFFLE_EMUHAWK_PATH`.

**CLI player** (against a running server):

```bash
bun run --filter @bizshuffle-bun/client-cli-app dev -- --join --name Player1 --server http://127.0.0.1:8080
```

## Tests

```bash
bun test
```

## Repo layout

| Path              | What                                            |
| ----------------- | ----------------------------------------------- |
| `apps/server`     | Headless server binary                          |
| `apps/desktop`    | Desktop host (Electrobun)                       |
| `apps/client-cli` | Player CLI                                      |
| `packages/*`      | Protocol, domain, server/client hosts, admin UI |
