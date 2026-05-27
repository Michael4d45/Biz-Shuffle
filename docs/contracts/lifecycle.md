# Lifecycle

## Shutdown order

1. Stop `ClientRuntime` (desktop)
2. Flush pending saves / disconnect Lua
3. `DesktopEmulatorService.stop` (tree-kill fallback)
4. `BizShuffleServer.stop` (close WS, discovery, flush state.json)

## Host and Play

1. `BizShuffleServer.start`
2. Open admin at http://127.0.0.1:{port}/
3. `ClientRuntime.start` on loopback
4. `DesktopEmulatorService.launch`

## Headless

BizShuffleServer.exe only — steps 1 + browser admin, no client/emulator.
