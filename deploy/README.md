# Deploy di CardVault

Due server Ubuntu 24.04 (qualsiasi VPS: Hetzner, OVH, Aruba…), possibilmente nello stesso data center UE
con rete privata tra loro.

| Server | Cosa gira | Porte aperte |
|---|---|---|
| **APP** | nginx (PWA + proxy `/api`), API in Docker | 22, 80, 443 |
| **DB** | PostgreSQL 17 | 22, 5432 **solo dall'IP del server APP** |

## 1. Server DB

```bash
scp -r deploy root@DB:/root/
ssh root@DB 'APP_SERVER_IP=<ip-app> DB_HOST=<ip-o-nome-db> /root/deploy/db-server/setup.sh'
```

Lo script installa PostgreSQL 17, genera una CA privata e il certificato del server (con l'IP o il nome
in `DB_HOST`), accetta solo connessioni `hostssl` con SCRAM dall'IP del server APP, attiva ufw e il
backup giornaliero cifrato con `age` (30 giorni). Alla fine stampa la `DATABASE_URL`.

**Copia fuori dal server** `/etc/cardvault-backup.key`: senza non puoi ripristinare i backup.
Per una copia remota imposta `RCLONE_REMOTE` in `/etc/cron.d/cardvault-backup`.

Ripristino di prova (fallo almeno una volta):

```bash
age -d -i cardvault-backup.key cardvault-AAAAMMGG-hhmmss.dump.age > db.dump
pg_restore --clean --if-exists -d cardvault db.dump
```

## 2. Server APP

```bash
scp -r deploy root@APP:/root/
ssh root@APP 'DOMAIN=cardvault.example.it EMAIL=admin@example.it /root/deploy/app-server/setup.sh'
scp root@DB:/etc/postgresql/cardvault-pki/ca.crt root@APP:/opt/cardvault/secrets/db-ca.crt
ssh root@APP 'nano /opt/cardvault/.env.production'
```

In `.env.production`: `DATABASE_URL` (dallo step 1), `JWT_SECRET` (`openssl rand -base64 48`),
`IMAGE_ENCRYPTION_KEY` (`openssl rand -base64 32` — **conservane una copia sicura**: serve a decifrare
le foto), `APP_URL`, `SMTP_URL`, `MAIL_FROM`.

## 3. Rilascio

Dal PC di sviluppo (servono pnpm, Docker e accesso SSH):

```bash
VITE_PRIVACY_CONTROLLER="Cosedil S.p.A., ..." VITE_PRIVACY_EMAIL=privacy@... \
VITE_PRIVACY_HOSTING="..." DEPLOY_HOST=root@cardvault.example.it ./deploy/deploy.sh
```

Lo script esegue lint, typecheck e test, compila la PWA e la copia in `/var/www/cardvault`,
costruisce l'immagine dell'API, la carica sul server, la avvia (le migrazioni del database partono
all'avvio, con lock) e verifica `https://<dominio>/api/health`.

## Monitoraggio e log

- Log API (JSON, rotazione 5×20 MB): `docker compose -f /opt/cardvault/docker-compose.yml logs -f api`
- Log nginx: `/var/log/nginx/`
- Log backup: `/var/log/cardvault-backup.log`
- Uptime: configura un controllo esterno (es. UptimeRobot, Better Stack) su `https://<dominio>/api/health`,
  che risponde 200 solo se il database è raggiungibile.

## Checklist sicurezza

- [ ] `DATABASE_SSL=verify-full` e CA copiata
- [ ] `ufw status` sul DB mostra 5432 aperta solo all'IP APP
- [ ] Segreti solo in `/opt/cardvault/.env.production` (permessi 600), mai nel repository
- [ ] Backup ripristinato almeno una volta
- [ ] HTTPS valido, rinnovo certbot attivo (`systemctl list-timers | grep certbot`)
- [ ] Test reale su iPhone: installa da Safari → Condividi → "Aggiungi a Home", scansiona, aggiungi a Rubrica
