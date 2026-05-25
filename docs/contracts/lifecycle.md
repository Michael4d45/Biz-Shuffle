# Lifecycle

## Shutdown order

1. Stop ClientRuntime (desktop)
2. Flush pending saves / disconnect Lua
3. EmulatorService.stop (tree-kill fallback)
4. ServerRuntime.stop (close WS, discovery, flush state.json)

## Host and Play

1. ServerRuntime.start
2. Open admin at http://127.0.0.1:{port}/
3. ClientRuntime.connect loopback
4. EmulatorService.launch

## Headless

BizShuffleServer.exe only — steps 1 + browser admin, no client/emulator.
