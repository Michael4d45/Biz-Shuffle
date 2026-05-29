---
name: bizhawk-ipc
description: Debugs and implements BizHawk Lua TCP IPC in TSBunShuffle — BizhawkIpc client, server.lua, port file, desktop Join launch, and FakeLuaPeer tests. Use for emulator connection issues, SAVE/SWAP failures, or integration test flakiness.
---

# BizHawk IPC

## Model

```
ClientRuntime → BizhawkIpc (TCP client) → server.lua (TCP server in BizHawk)
                      ↑
            lua_server_port.txt (written before EmuHawk launch)
```

**Do not** make `BizhawkIpc` a TCP server — Lua owns the listen socket.

## Key files

| File                                          | Role                                                      |
| --------------------------------------------- | --------------------------------------------------------- |
| `packages/client-host/src/bizhawk-ipc.ts`     | TCP client, command queue, reconnect                      |
| `packages/client-host/src/runtime.ts`         | Starts IPC, `waitForBizhawkIpc()`, `setBizhawkLaunched()` |
| `packages/client-host/src/controller.ts`      | WS commands → IPC (SAVE, SWAP, PAUSE)                     |
| `assets/server.lua`                           | BizHawk-side listener; copy/sync to client data dir       |
| `apps/desktop/src/bun/emulator-service.ts`    | Launch BizHawk after port file exists                     |
| `packages/testing/src/fakes/fake-lua-peer.ts` | Test double for Lua                                       |

## Wire protocol

1. Lua sends `HELLO\n` on connect
2. Client sends `CMD|{id}|{COMMAND}|{args...}\n`
3. Lua replies `ACK|{id}\n` or `NACK|{id}|{reason}\n`

Commands: `SAVE`, `SWAP`, `PAUSE`, etc. (see `assets/server.lua`).

## Integration test pattern

```typescript
peer = await FakeLuaPeer.listen({ savesDir: clientDir, instanceId });
writeLuaPortFile(join(clientDir, "lua_server_port.txt"), peer.port);

runtime = new ClientRuntime({
  dataDir: clientDir,
  serverUrl: server.url,
  playerName: "p",
  enableBizhawkIpc: true,
  luaPort: peer.port,
});
await runtime.start();
await runtime.waitForBizhawkIpc(20_000);
// now trigger server request_save or send IPC commands
```

## Checklist when IPC fails

- [ ] Port file exists before BizHawk process starts
- [ ] `BizhawkIpc.isReady()` true before SAVE/SWAP
- [ ] `server.lua` in client data dir matches bundled `assets/server.lua`
- [ ] BizHawk cwd is client `dataDir` so relative paths resolve
- [ ] On restart: stop client/emulator first; don't delete port file unnecessarily
