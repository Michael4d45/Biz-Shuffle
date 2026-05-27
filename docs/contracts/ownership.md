# Ownership Matrix

| Resource           | Owner                                |
| ------------------ | ------------------------------------ |
| Session state      | `ServerSession` / `BizShuffleServer` |
| state.json writes  | `Persistence`                        |
| BizHawk            | `DesktopEmulatorService` (desktop)   |
| Discovery sockets  | `discovery` module                   |
| WS connections     | `WsHub`                              |
| Admin static + API | `@bizshuffle-bun/server-host`        |
| Admin UI           | `@bizshuffle-bun/admin-ui` (HTTP/WS) |
