# coach-clock

TypeScript-monorepo: npm workspaces + Turborepo. Projektbeskrivning tillkommer.

## Layout

- `apps/*` — körbara applikationer
- `packages/*` — delade paket
- `packages/tsconfig` — delade TS-konfigurationer, ärvs via `@coach-clock/tsconfig/{base,node,react}.json`

## Kommandon

Kör alltid från roten; Turborepo fläktar ut till workspaces.

```bash
npm install
npm run build
npm run typecheck
npm run lint
npm test
npm run format
```

## Konventioner

- Nya paket namnges `@coach-clock/<namn>` och sätts `"private": true` om de inte ska publiceras.
- Varje workspace exponerar `build`, `lint`, `typecheck` och `test` i sina scripts så att rotkommandona fungerar.
- TypeScript körs strikt (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — ärv från `packages/tsconfig`, sänk inte nivån lokalt.
- Commit-format: `<type>: <beskrivning>` (feat, fix, refactor, docs, test, chore, perf, ci).
