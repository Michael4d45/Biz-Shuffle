# Ownership Matrix

| Resource           | Owner                                  |
| ------------------ | -------------------------------------- |
| Session state      | SessionService / server session module |
| state.json writes  | PersistenceService                     |
| BizHawk            | EmulatorService (desktop main only)    |
| Discovery sockets  | DiscoveryService                       |
| WS connections     | ConnectionManager / ws module          |
| Admin static + API | @bizshuffle/server                     |
| Admin UI           | packages/admin (HTTP/WS consumer only) |
