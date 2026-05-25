# Agent guide — TSBunShuffle

Cursor rules live in [`.cursor/rules/`](.cursor/rules/). Project skills live in [`.cursor/skills/`](.cursor/skills/).

## Start here

1. **Product & protocol** — [`docs/SPEC.md`](docs/SPEC.md)
2. **Contracts** — [`docs/contracts/`](docs/contracts/)
3. **Quality gates** — `bun run typecheck && bun run lint && bun run format:check && bun test`

## Skills (invoke when relevant)

| Skill | Use when |
|-------|----------|
| `dev-workflow` | Running dev servers, tests, releases, CI |
| `bizhawk-ipc` | Lua IPC, Host & Play, emulator integration tests |
| `spec-and-contracts` | HTTP/WS API changes, protocol edits |

## Architecture (short)

```
admin-ui ──HTTP/WS──► server-host ◄──HTTP/WS── client-host ──TCP──► server.lua (BizHawk)
                         │                              │
                    roms/saves/state.json          dataDir/plugins
```

Domain logic stays pure in `@bizshuffle-bun/domain`. Admin UI must not import server-host.
