# Tekniska beslut

Beslut som formar koden och som inte går att läsa ut ur den. Nyaste sist.

---

## ADR-001 — 2026-09-25 — Tränaren loggar in med Google; sidlinjen förblir kontolös

**Status:** Accepterad

**Kontext:**
Fram till nu hade coach-clock inga konton alls (#16). Lag och matcher var
oägda: den som kände till ett lag-id kunde läsa truppen, lägga till spelare och
starta en match, och `POST /matches/share` krävde ingenting. Det räckte för en
tränare på en telefon, men inte för en app där flera tränare har egna lag.

Säkerhetslösningen är medvetet densamma som i fc-app (dess ADR-004), så att två
appar från samma håll inte har två olika sätt att hantera sessioner.

**Beslut:**

- **Bara tränaren loggar in.** Domare och åskådare går fortfarande med via länk
  eller kod utan konto — ingen ska behöva skriva ett lösenord i regnet (#16).
  Deras rättigheter i matchen bärs som förut av deltagarcookien
  (`coach_clock_participant`), och matchvyn har ingen inloggningsvakt, så den
  fungerar offline.
- **OAuth 2.0 / OpenID Connect med Google**, bakom en leverantörsneutral
  `identities`-tabell (provider + subject) så att fler leverantörer kan läggas
  till utan schemaändring. Inga lösenord lagras.
- **Konton länkas på e-post, och bara på en verifierad.** `email_verified` måste
  vara sant, annars skapas inget konto. E-posten normaliseras till gemener.
- **Serverhanterade sessioner.** 32 slumpbytes i en `HttpOnly; SameSite=Lax`-cookie
  (`coach_clock_session`, `Secure` i produktion), 30 dagars livslängd. Bara
  sha256 av token lagras, som för deltagartokens. Utgångna sessioner städas vid
  användarens nästa inloggning. Utloggning tar bort raden, inte bara cookien.
- **CSRF i OAuth-flödet** stoppas av en `state` som binds till webbläsaren via en
  kortlivad cookie (10 min). Vart användaren ska efteråt (`returnTo`) bor i
  samma cookie och godtas bara som en sökväg på vår egen frontend — aldrig
  `//värd`, `/\värd` eller en absolut URL — så att inloggningen inte blir en
  öppen omdirigering.
- **Callbacken ligger på webbens origin** (`…/api/auth/google/callback`, genom
  `/api`-rewriten). Det är svaret som sätter sessionscookien, så det måste komma
  från det origin cookien tillhör.
- **Ägarskap:** `teams.owner_user_id`. Lag, spelare, matchstart och delning
  kräver inloggning och att tränaren äger laget. Någon annans lag svarar `404`,
  precis som ett lag som inte finns, så att id:n inte kan sonderas.
- **Utvecklingsinloggning** (`GET /auth/dev-login`) finns för att klicka igenom
  appen lokalt utan Google. Filen `*.dev.ts` byggs aldrig in i produktion och
  laddas bara när `ENABLE_DEV_LOGIN=true` och `NODE_ENV` inte är `production`.
- **I produktion stoppar en saknad Google-konfiguration starten.** Utan den kan
  ingen tränare nå sina lag, och det ska synas vid deployen — inte när någon
  trycker på knappen.

**Alternativ som valdes bort:**

- **Konto för alla roller.** Bryter mot #16 och gör sidlinjen långsammare för
  dem som minst behöver det.
- **E-post och lösenord** (fc-apps ADR-024). Kräver en mejlleverantör för
  verifiering och återställning; kan läggas till senare bakom samma `users`- och
  `sessions`-tabeller, på samma sätt som i fc-app.
- **JWT i localStorage.** Kan läsas av vilket skript som helst på sidan och går
  inte att återkalla vid utloggning.

**Konsekvenser:**

- Lag skapade före inloggningen har `owner_user_id = null` och syns inte för
  någon förrän de tilldelas en ägare (docs/deployment.md).
- Ägarens rätt att skriva i en pågående match är fortfarande knuten till den
  enhet som startade matchen (deltagarcookien), inte till kontot. Att fortsätta
  en match från en annan inloggad enhet är ett eget steg.
- Driftsättningen kräver en Google OAuth-klient och fyra nya miljövariabler.
