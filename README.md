# coach-clock

TypeScript-monorepo. Projektbeskrivningen fylls i när omfattningen är satt.

## Struktur

```
apps/          körbara applikationer
  backend/     node:http + oRPC OpenAPIHandler, port 4002
  frontend/    Vite + React + TanStack Router/Query + Tailwind v4, port 5174
docker/        docker-compose för lokal Postgres (port 5434)
packages/      delade paket
  contracts/   oRPC-kontrakt, Zod-scheman och ren domänlogik
  tsconfig/    delade TypeScript-konfigurationer (base / node / react)
```

## Kom igång

```bash
npm install
cp .env.example .env
npm run docker:db
npm run migrate -w apps/backend
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

### Databas

| Kommando                                   | Gör                                    |
| ------------------------------------------ | -------------------------------------- |
| `npm run docker:db`                        | Startar Postgres 16 på port 5434       |
| `npm run docker:test-db`                   | Skapar integrationstesternas databas   |
| `npm run docker:down`                      | Stoppar och river containern           |
| `npm run migrate -w apps/backend`          | Kör migrationerna till senaste         |
| `npm run migrate:down -w apps/backend`     | Rullar tillbaka en migration           |
| `npm run test:integration -w apps/backend` | Integrationstester mot riktig Postgres |

Enhetstesterna (`npm test`) rör aldrig databasen — Kysely-klienten är en lazy singleton
och ansluter först när någon faktiskt frågar.

Integrationstesterna droppar alla tabeller innan de kör. De kör därför bara mot
`TEST_DATABASE_URL` — en separat databas vars namn innehåller "test" — och vägrar starta
utan den eller mot utvecklingsdatabasen. Skapa den en gång med `npm run docker:test-db`
och lägg adressen i `.env` (se `.env.example`).

## Driftsättning

Två tjänster på Render (statisk frontend + Node-API) med Neon som databas, allt
deklarerat i [`render.yaml`](render.yaml). Uppsättning, miljövariabler och
felsökning: [docs/deployment.md](docs/deployment.md).

## Krav

- Node.js 20 eller senare
- npm 11
- Docker (för den lokala databasen)
