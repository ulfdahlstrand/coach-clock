# coach-clock

TypeScript-monorepo. Projektbeskrivningen fylls i när omfattningen är satt.

## Struktur

```
apps/          körbara applikationer (frontend, backend, CLI …)
packages/      delade paket
  tsconfig/    delade TypeScript-konfigurationer (base / node / react)
```

## Kom igång

```bash
npm install
```

## Kommandon

| Kommando            | Gör                                   |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Startar dev-servrar i alla workspaces |
| `npm run build`     | Bygger alla workspaces                |
| `npm run typecheck` | Typkontroll                           |
| `npm run lint`      | Lintar alla workspaces                |
| `npm test`          | Kör tester                            |
| `npm run format`    | Formaterar med Prettier               |

Alla kommandon körs via [Turborepo](https://turbo.build) över workspaces.

## Krav

- Node.js 20 eller senare
- npm 11
