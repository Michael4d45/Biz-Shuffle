# Lifecycle

## Shutdown order

1. Stop `ClientRuntime` (desktop)
2. Flush pending saves / disconnect Lua
3. `DesktopEmulatorService.stop` (tree-kill fallback)
4. `BizShuffleServer.stop` (close WS, discovery, flush state.json)

## Desktop Host

1. `BizShuffleServer.start` (embedded)
2. Open admin at http://127.0.0.1:{port}/ (or bind-specific URL)

No player client or BizHawk on this path.

## Desktop Join

1. Dependencies panel: BizHawk (+ VC++ on Windows) satisfied
2. Reserve Lua port → write `lua_server_port.txt`
3. `DesktopEmulatorService.launch` (`EmuHawk` + `server.lua` in data dir)
4. `ClientRuntime.start` → WebSocket `hello` to server URL

To host and play on one machine: **Host**, then **Join** against the hosted URL (or pick it from discovery).

## Headless / release server

`bizshuffle-server.exe` (or `bun run dev:server`) — HTTP admin + session only; no client/emulator in that process.
