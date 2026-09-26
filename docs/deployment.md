# Driftsättning

coach-clock körs på **Render** (två tjänster) med **Neon** som databas. Allt
ligger på gratisplan, så driften kostar ingenting. Formen är deklarerad i
[`render.yaml`](../render.yaml) i repo-roten, så tjänsterna är reproducerbara
i stället för hopklickade.

| Del                              | Var                | Plan   | Sover?                                               |
| -------------------------------- | ------------------ | ------ | ---------------------------------------------------- |
| `coach-clock-web` — Vite-SPA:n   | Render static site | Gratis | Nej. CDN-serverad, drar inga instanstimmar.          |
| `coach-clock-api` — oRPC-servern | Render web service | Gratis | Ja. Efter 15 min utan trafik, ~1 min att vakna.      |
| PostgreSQL                       | Neon               | Gratis | Skalar till noll efter 5 min, vaknar vid anslutning. |

Webbläsaren pratar aldrig direkt med `coach-clock-api`. En rewrite på den
statiska sajten proxar `/api/*` dit, så hela appen bor på ett origin — se
[Varför API:t proxas](#varför-apit-proxas) längst ned.

## Eget Render-workspace

**Skapa coach-clock i ett eget Render-workspace, inte i samma som fc-app.**
Renders 750 gratis instanstimmar per månad är en pott per _workspace_, inte per
tjänst, och en tjänst som är vaken dygnet runt förbrukar ~730 av dem. När potten
tar slut suspenderar Render _alla_ gratis web services i workspacet — alltså
skulle coach-clock kunna släcka fc-app mitt i en säsong, och tvärtom. Statiska
sajter kostar inga timmar och påverkas inte.

## Det som inte är automatiserat

Två saker är medvetet manuella: att skapa kontona, och att fylla i hemligheterna.
Inget annat behöver dashboarden efter första deployen — en push till `main`
driftsätter båda tjänsterna på nytt.

## Första uppsättningen

### 1. Konton

**Render** — registrera dig på [render.com](https://render.com) **med GitHub**,
i ett workspace som bara används för coach-clock. Det ger den repo-åtkomst som
auto-deployen behöver. Välj _Only select repositories_ och peka ut `coach-clock`.

**Neon** — registrera dig på [neon.com](https://neon.com), skapa ett projekt i
**AWS eu-central-1 (Frankfurt)** så att det ligger nära Render-tjänsterna, och
kopiera anslutningssträngen.

Justera strängen innan den används: Neon delar ut `?sslmode=require`, men `pg`
8.x loggar en deprecation-varning vid varje start för allt annat än
`verify-full`. Båda verifierar certifikatet, så använd:

```
postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=verify-full
```

**Google OAuth-klient** — tränarna loggar in med Google (ADR-001). I
[Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Skapa ett projekt och konfigurera **OAuth consent screen** (extern, scopen
   `openid`, `email` och `profile` räcker).
2. **Create credentials → OAuth client ID**, typ _Web application_.
3. Lägg till omdirigerings-URI:n
   `https://coach-clock-web.onrender.com/api/auth/google/callback` — på
   **webbens** värd, inte API:ts. Lägg gärna till
   `http://localhost:5174/api/auth/google/callback` för lokal utveckling via
   Vite-proxyn (`VITE_API_URL=/api`).
4. Kopiera klient-id och klienthemlighet.

### 2. Skapa tjänsterna

I Render-dashboarden: **New → Blueprint**, välj repot `coach-clock`. Render läser
`render.yaml` och frågar efter varje `sync: false`-variabel.

Fyll i för **coach-clock-api**:

| Variabel               | Värde                                                           |
| ---------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`         | Neon-strängen från steg 1                                       |
| `CORS_ORIGIN`          | `https://coach-clock-web.onrender.com`                          |
| `GOOGLE_CLIENT_ID`     | Från Google-klienten i steg 1                                   |
| `GOOGLE_CLIENT_SECRET` | Från Google-klienten i steg 1                                   |
| `AUTH_CALLBACK_URL`    | `https://coach-clock-web.onrender.com/api/auth/google/callback` |
| `FRONTEND_URL`         | `https://coach-clock-web.onrender.com`                          |

Värdnamnet är inte känt förrän webbtjänsten har deployat — gissa namnet och
rätta det i steg 3 om Render la på ett suffix. `VITE_API_URL` behöver inget av
dig: `render.yaml` låser den till `/api`.

### 3. Knyt ihop

När båda tjänsterna är live, notera deras faktiska URL:er och:

1. Kontrollera att `CORS_ORIGIN` och `FRONTEND_URL` på **coach-clock-api**
   matchar webb-URL:en exakt — protokoll och värd, inget avslutande snedstreck —
   och att `AUTH_CALLBACK_URL` är samma värd plus `/api/auth/google/callback`,
   precis som i Google-klienten.
2. Om Render la ett suffix på **API:ts** värdnamn: rätta destinationen i
   `/api/*`-rewriten i `render.yaml` och pusha. Den är committad, inte en
   miljövariabel.

### 4. Verifiera

Öppna webb-URL:en, logga in med Google, skapa ett lag och en match, dela koden
och gå med från en annan enhet — utan att logga in där.
Hänger första anropet i ungefär en minut är det API:t som vaknar, inte ett fel.

Checklista som faktiskt fångar de fel som bara syns driftsatt:

- **Testa på telefon, inte bara i desktop-Chrome.** Chrome på desktop är den mest
  tillåtande webbläsaren som finns när det gäller cookies. iOS och Firefox är de
  som avslöjar en trasig cookie-uppsättning.
- **Kontrollera att matchvyn uppdateras i realtid på en andra enhet.** SSE-strömmen
  går genom CDN-rewriten, och en proxy som buffrar skulle leverera händelserna i
  klumpar i stället för direkt. Backend sätter redan `x-accel-buffering: no` och
  `cache-control: no-transform` på strömmen, vilket är det man kan göra från vår
  sida — men det är värt att se efter första deployen. Kommer händelserna i skov
  är det buffringen, inte klockan.
- **Klockan ska överleva att skärmen släcks och att appen återvänder från
  bakgrunden** — strömmen återansluter med `Last-Event-ID` och läsendpointen är
  sanningen.

## CLI:t

Valfritt, men bättre än dashboarden för det dagliga:

```bash
brew install render
```

```bash
render login
```

Användbara kommandon:

```bash
render services            # lista tjänster och status
render deploys create      # trigga en deploy
render logs --tail         # liveloggar
render blueprints validate # kontrollera render.yaml innan commit
```

CLI:t kan inte skapa ett konto, och det kan inte starta en Blueprint — det
första steget är bara dashboard. Därefter klarar det allt annat.

## Migrationer

Migrationerna körs automatiskt som sista steg i API:ts **build command**, en gång
per deploy och innan den nya koden går live. Renders pre-deploy-hook, som vore
det naturliga hemmet, finns bara på betalplan.

En konsekvens att ha med sig: ett bygge som migrerar och sedan misslyckas med att
deploya lämnar schemat före den kod som kör. Håll migrationerna bakåtkompatibla
med föregående release — lägg till kolumner innan de används, ta bort dem en
release senare.

Köra migrationerna för hand:

```bash
DATABASE_URL='postgresql://…' npm run migrate -w apps/backend
```

## Miljövariabler

`render.yaml` sätter de här; de listas också här så att det driftsatta
kontraktet går att läsa på ett ställe.

| Variabel               | Tjänst | Sätts av      | Noteringar                                                                                                                        |
| ---------------------- | ------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                 | api    | Render        | Injiceras. Servern föredrar den framför sin default 4002.                                                                         |
| `NODE_ENV=production`  | api    | `render.yaml` | Gör också att ett saknat `DATABASE_URL` stoppar starten i stället för att tyst peka på localhost.                                 |
| `DATABASE_URL`         | api    | Du            | Neon, `sslmode=verify-full`.                                                                                                      |
| `CORS_ORIGIN`          | api    | Du            | Webb-URL:en. Appens egna anrop är same-origin och behöver den inte — den finns för att listan inte ska stå kvar på dev-defaulten. |
| `GOOGLE_CLIENT_ID`     | api    | Du            | Google OAuth-klienten. Saknas den i produktion startar inte API:t.                                                                |
| `GOOGLE_CLIENT_SECRET` | api    | Du            | Hemlig. Committas aldrig.                                                                                                         |
| `AUTH_CALLBACK_URL`    | api    | Du            | På webbens origin: `…/api/auth/google/callback`. Måste stå i Google-klienten.                                                     |
| `FRONTEND_URL`         | api    | Du            | Webb-URL:en. Dit tränaren skickas efter inloggningen.                                                                             |
| `VITE_API_URL=/api`    | web    | `render.yaml` | Byggtid. Relativ, så den löses mot sidans eget origin.                                                                            |

## Lag från före inloggningen

Lag skapade innan inloggningen fanns har ingen ägare och syns inte för någon.
Logga in en gång, så att kontot finns, och tilldela dem sedan i Neons SQL-editor:

```sql
update teams
set owner_user_id = (select id from users where email = 'din@adress.se')
where owner_user_id is null;
```

## Varför API:t proxas

De två tjänsterna är skilda värdar, och `onrender.com` ligger på Public Suffix
List, så webbläsare behandlar subdomänerna som olika **sajter**. Att prata med
`coach-clock-api` direkt skulle göra deltagar- och sessionscookien
(`coach_clock_participant` och `coach_clock_session`, båda `HttpOnly; SameSite=Lax`)
tredjeparts, och iOS —
Safari, Chrome och Firefox, alla kör på WebKit där — blockerar
tredjepartscookies rakt av, liksom Firefox på desktop. Felet är elakt: man går
med i matchen, det ser lyckat ut, och sedan är varje anrop anonymt. Desktop-Chrome
släpper fortfarande igenom cookien, vilket är precis därför det här gömmer sig i
den webbläsare man utvecklar i.

Så den statiska sajten äger origin och vidarebefordrar till API:t:

```yaml
- type: rewrite
  source: /api/*
  destination: https://coach-clock-api.onrender.com/*
```

Splatten tar bort prefixet, så `/api/matches/stream` når backend som
`/matches/stream` och ingen route behöver veta att den proxas. `VITE_API_URL=/api`
är den andra halvan som måste stämma med regeln;
[`api-client.ts`](../apps/frontend/src/lib/api-client.ts) löser den mot sidans
origin, och `streamUrl` i
[`match-event-stream.ts`](../apps/frontend/src/lib/match-event-stream.ts) lägger
sin sökväg _på_ basen i stället för att lösa mot den, så att prefixet överlever.

CORS är fortfarande konfigurerat på backend trots att same-origin-anrop inte
behöver det — lokal utveckling kör SPA:n på `:5174` mot API:t på `:4002`.

## Gratisgränser värda att känna till

- **750 instanstimmar per månad, delade av hela Render-workspacet** — inte per
  tjänst. Därav det egna workspacet ovan.
- **Neon: 0,5 GB lagring, 100 beräkningstimmar per månad.** Skala-till-noll gör
  att en vilande databas inte kostar något.
- **Renders gratistjänster har ingen beständig disk.** Allt som skrivs till
  filsystemet försvinner vid omstart, deploy och varje uppvaknande. Allt tillstånd
  hör hemma i Postgres. Det gäller även SSE-prenumerationerna, som lever i minnet
  per instans — vid en omstart tappar klienterna strömmen och återansluter med
  `Last-Event-ID`.

## Att bli av med kallstarten

Uppgradera **bara** `coach-clock-api` till Render Starter (~$7/månad) och sätt
`plan: starter` i `render.yaml`. Den statiska sajten förblir gratis, så det är
den enda uppgradering projektet realistiskt behöver. En match som pågår håller
instansen vaken av sig själv via SSE-strömmen; det kallstarten kostar är den
första minuten för den som öppnar appen först. Papprera inte över sömnen med en
extern uptime-pingare — den bränner 750-timmarspotten genom att hålla tjänsten
vaken dygnet runt, och då suspenderar Render tjänsten.
