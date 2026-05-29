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

**Desktop app** (Host, Join):

```bash
bun run build:admin && bun run dev:desktop
```

- **Host** — embedded server + browser admin (no BizHawk).
- **Join** — player client + BizHawk (blocked until dependencies are satisfied).

On Windows, install **BizHawk** and the **Visual C++ runtime** from the shell dependencies panel. BizHawk is installed under `%USERPROFILE%\BizShuffle\BizHawk\` (managed install). After install, `config.json` may contain `bizhawk_path` pointing at that `EmuHawk.exe` — paths outside the managed folder are not used.

**CLI player** (WebSocket only; no BizHawk):

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
| `apps/client-cli` | Player CLI (WebSocket only; no BizHawk)         |
| `packages/*`      | Protocol, domain, server/client hosts, admin UI |
