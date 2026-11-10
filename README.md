# CardVault

App per digitalizzare e archiviare biglietti da visita, con esperienza "wallet". PWA installabile
su iPhone e Android, riconoscimento del testo **sul dispositivo** (Tesseract.js, nessun servizio
AI/OCR esterno, nessun LLM), ricerca per campi tollerante a errori e accenti.

## Architettura

```
 Telefono (PWA)                       Server APP                         Server DB
 ┌──────────────────────┐   HTTPS    ┌──────────────────────────┐ TLS   ┌────────────────────┐
 │ React + Vite         │──────────▶ │ nginx  /      → PWA      │──────▶│ PostgreSQL 17      │
 │ Tesseract.js (worker)│ stesso     │        /api/* → API      │verify │ pg_trgm + unaccent │
 │ IndexedDB (coda)     │ dominio    │ Docker: API Fastify :3000│ -full │ solo IP server APP │
 └──────────────────────┘            └──────────────────────────┘       │ backup cifrati 30gg│
                                                                         └────────────────────┘
```

| Cartella | Contenuto |
|---|---|
| `apps/web` | PWA: wallet, scanner (fotocamera, ritaglio prospettico, OCR), revisione, ricerca, il mio biglietto, impostazioni |
| `apps/api` | API REST Fastify: auth, contatti, ricerca, immagini cifrate, export/import, GDPR |
| `packages/parser` | Estrazione deterministica dei campi dal testo OCR (regex + dizionari + layout) |
| `packages/shared` | Schemi zod, vCard 2.1/3.0/4.0, CSV, telefoni |
| `e2e` | Test Playwright su WebKit (iPhone) e Chromium (Android) |
| `deploy` | nginx, Docker, script di provisioning dei due server, backup |

### Funzioni

- **Schedario rotante** (vista predefinita) con linguette A–Z, foto vera del biglietto sulle carte vicine, swipe laterale per passare alla carta successiva; in alternativa la vista **Pila**.
- **Modalità evento**: a una fiera ogni nuovo biglietto prende nome dell'evento, data e tag (per dispositivo e utente).
- **Scansione a raffica**: tanti biglietti di fila (o più foto dalla galleria), ritaglio automatico, OCR in coda sul telefono, revisione e «Salva tutti».
- **Promemoria «Ricontatta il…»**: lista `/promemoria`, file calendario `.ics`, notifica push mattutina (Web Push con VAPID + cron giornaliero; su iPhone con l'app nella schermata Home).
- **Team / rubrica condivisa** (es. Cosedil): ingresso solo con link di invito (token nel frammento URL, 7 giorni, revocabile); i colleghi vedono solo i dati del biglietto e le foto, mai note, tag, evento o promemoria; «Salva nei miei» copia il biglietto nel proprio wallet.
- **Azioni rapide**: Chiama, WhatsApp (solo cellulari), Email, Mappa, Rubrica; scorciatoie dall'icona dell'app (Android) e schermate di avvio iOS (`apps/web/scripts/make-splash.mjs`).

### Scelte principali

- **OCR locale**: motore WASM e modelli `ita`+`eng` serviti dal nostro dominio (`/ocr`), messi in cache dal service worker. Le immagini non lasciano il telefono finché l'utente non salva.
- **Parser**: prima cerca un QR vCard/MECARD (dati esatti), poi OCR. Ogni campo ha una confidenza: sotto 0,6 è evidenziato "Da verificare" nella revisione.
- **Sicurezza**: password Argon2id, access token JWT 15 min in memoria, refresh token opaco in cookie httpOnly ruotato a ogni uso con rilevamento del riuso, blocco dopo 10 tentativi, rate limiting, CSP stretta, foto cifrate AES-256-GCM legate a contatto e lato.
- **Offline**: le scansioni senza rete finiscono in una coda IndexedDB e partono al ritorno della connessione (all'avvio, su `online` e quando l'app torna in primo piano: iOS non ha Background Sync). Ogni elemento ha un `clientRef` idempotente: un nuovo tentativo non crea doppioni.
- **iPhone**: fotocamera via `getUserMedia` (HTTPS, `playsinline`), fallback alla fotocamera nativa; immagini ridotte a 2048 px (limite canvas iOS); "Aggiungi a Rubrica" apre la vCard con un link firmato di 2 minuti (iOS importa i contatti solo da navigazione, non da download); API sullo stesso dominio per evitare i blocchi ITP sui cookie.

## Sviluppo

Requisiti: Node ≥ 22, pnpm 11. Nessun Docker né PostgreSQL da installare.

```bash
pnpm install
pnpm dev:db      # terminale 1: PostgreSQL embedded in apps/api/.pgdata, crea apps/api/.env
pnpm dev         # terminale 2: API :3000 + PWA http://localhost:5173
```

Provare su iPhone nella stessa rete Wi-Fi (la fotocamera richiede HTTPS):

```bash
cd apps/web && HTTPS=1 pnpm dev   # poi apri https://<ip-del-pc>:5173 e accetta il certificato
```

### Test

```bash
pnpm lint && pnpm typecheck
pnpm test                          # parser (30+ biglietti), shared, API su PostgreSQL embedded, web
pnpm --filter @cardvault/web build && pnpm e2e   # login → scansione → salvataggio → ricerca, offline, layout
```

Biglietti reali per il parser: aggiungi coppie `packages/parser/test/real/<nome>.txt` (testo OCR) +
`<nome>.json` (campi attesi). La cartella può restare fuori dal repository se contiene dati personali.
`npx tsx packages/parser/test/debug.ts` mostra le differenze campo per campo.

## Deploy

Vedi [deploy/README.md](deploy/README.md). In breve:

1. Server DB: `deploy/db-server/setup.sh` (PostgreSQL 17, TLS, firewall, backup).
2. Server APP: `deploy/app-server/setup.sh` (nginx, HTTPS, Docker, firewall).
3. Dal PC: `DEPLOY_HOST=root@dominio ./deploy/deploy.sh` (test, build PWA e immagine API, smoke test).

## Da completare prima della produzione

- Dati del titolare nell'informativa: `VITE_PRIVACY_CONTROLLER`, `VITE_PRIVACY_EMAIL`, `VITE_PRIVACY_HOSTING` al build della PWA, revisione legale del testo.
- SMTP per le email di reset password (`SMTP_URL`).
- Dominio, provider dei due server.
- Almeno 30 biglietti reali anonimizzati in `packages/parser/test/real/`.
