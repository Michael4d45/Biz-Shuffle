---
name: admin-ui
description: >-
  Builds and edits the BizShuffle admin React SPA (`packages/admin-ui`). Use for
  admin panel UI, GOShuffle parity, modals/cards, Tailwind styling, or admin
  fetch/WS wiring. React Compiler is enabled — do not add redundant useMemo/useCallback.
---

# Admin UI

Package: `@bizshuffle-bun/admin-ui` → built to `packages/server-host/priv/static`.

## Stack

| Piece              | Location                                                             |
| ------------------ | -------------------------------------------------------------------- |
| React 18 + Vite 8  | `packages/admin-ui/vite.config.ts`                                   |
| **React Compiler** | `reactCompilerPreset({ target: "18" })` via `@rolldown/plugin-babel` |
| Tailwind 4         | `@tailwindcss/vite`                                                  |
| ESLint             | `eslint-plugin-react-compiler` on `packages/admin-ui/**/*`           |

## React Compiler (important)

The admin panel is **compiler-optimized**. Do **not** add `useCallback` / `useMemo` unless there is a rare, documented exception.

- Use normal functions in components and hooks (`function onSave() { ... }`, `async function refresh() { ... }`).
- Removing existing `useCallback`/`useMemo` when touching code is encouraged.
- For `useEffect`, avoid callback wrappers; inline fetch logic or use module-level helpers instead of `useCallback` for deps.

See rule: `.cursor/rules/admin-ui-react-compiler.mdc`.

## Dev

```bash
bun run build:admin          # before server/desktop serves UI
bun run dev:admin            # Vite HMR, proxies /api /ws to :8080
bun run dev:server -- --data-dir ./data --port 8080
```

## Boundaries

- **No** `@bizshuffle-bun/server-host` imports (arch test).
- HTTP/WS shapes: `docs/SPEC.md`, `docs/contracts/`; legacy behavior reference: `../GOShuffle/web/index.html`.
- Shared API helpers: `packages/admin-ui/src/api.ts`.

## Quality gates (admin changes)

```bash
bun run typecheck
bun run lint
bun run format:check
bun test
bun run build:admin
```

## Layout (common touch points)

| Area          | Path                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| App shell     | `src/App.tsx`, `src/useAdmin.ts`                                         |
| Cards         | `src/components/*Card.tsx`, `*Modal.tsx`                                 |
| Hooks         | `src/hooks/`                                                             |
| Save-mode DnD | `PlayerDragContext.tsx`, `usePlayerDragDrop.ts`, `SaveInstancesCard.tsx` |
