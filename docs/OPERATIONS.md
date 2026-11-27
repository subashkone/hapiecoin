# HapieCoin operations guide

Written 27 Nov 2026, the day the private copy went live. It is the plain-language companion to the runbook in `docs/deploy.md` §6: this file says what exists, who owns what and how work flows; the runbook has the exact commands. The decisions behind it are ADR-151 and ADR-152 in `docs/DECISIONS.md`; what is still unproven is GAPS #186 in `GAPS.md`.

No secret is written here or anywhere in the repository. Every secret is in the owner's password manager and in one file on the server.

## 1. What exists

| Part | Where | Details |
|---|---|---|
| The site | `https://app.hapiecoin.com` | Behind a password gate (one shared user name and password), then the normal sign-in by emailed code |
| The price feed | `wss://ws.hapiecoin.com` | Public market data only; `/healthz` is public, `/metrics` is closed |
| Server | Azure, resource group `rg-hapiecoin`, Japan East (Tokyo) | Virtual machine `hapiecoin-1`: 4 vCPUs, 16 GB, Ubuntu 24.04, 64 GB disk. Fixed address `20.222.225.36` |
| Database | Azure, same resource group and region | Managed PostgreSQL 17 `hapiecoin-db`: 2 vCores, 4 GB, 32 GB growing by itself, 14 days of point-in-time backups. Reachable only from the server's address, encrypted connections only |
| Domain | GoDaddy | `hapiecoin.com`; records `app` and `ws` point at the server; three records for the mail sender |
| Mail | Resend | Sending domain `hapiecoin.com`, sender `no-reply@hapiecoin.com` |
| Code and images | GitHub, `subashkone/hapiecoin` (private) | Images in GitHub's registry, `ghcr.io/subashkone/hapiecoin-{api,gateway,ingest,web}`, one set per commit of `main` |

On the server, six containers run from `/opt/hapiecoin/deploy/compose.prod.yml`: `caddy` (the only public door, ports 80 and 443), `web`, `api`, `gateway`, `ingest`, `redis`. The database is not on the server.

Why Tokyo: the exchange's data centres are there (about 15 ms from the server), and the owner's Azure subscription is offered almost no machine sizes in Singapore. The cost is a slower site for users in India than a nearer region would give.

### What it costs
List prices on 27 Nov 2026, before tax, paid from the owner's Azure sponsorship credit:

| Item | Per month |
|---|---|
| Server (machine, disk, fixed address) | about USD 158 |
| Database (server and storage) | about USD 80 |
| **Total** | **about USD 238** |

The domain is a yearly fee at GoDaddy. What the Resend and GitHub accounts cost is not recorded here. When the credit ends, the fallback from the research (`docs/research/deployment-providers.md`) is one OVHcloud server at about INR 1,125 a month, with the database back on the machine.

## 2. Who holds what

| Thing | Holder |
|---|---|
| Azure, GoDaddy, Resend and GitHub accounts | The owner |
| The key that signs in to the server (`.ssh/id_rsa` in the owner's user folder) | The owner's laptop, with a backup the owner keeps |
| The server's settings (`/opt/hapiecoin/deploy/.env`) | On the server only; the values are also in the owner's password manager |
| The gate password | The owner, shared with the invited users |

The owner types every secret. A Claude session never reads a `.env` file and is never given a secret in chat. Commands that print a secret (creating a database, a password) are pasted by the owner in their own terminal.

The settings file holds, by name: `APP_DOMAIN`, `WS_DOMAIN`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CREDENTIALS_ENC_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `METRICS_TOKEN`, `RELEASE`, `IMAGE_OWNER`, `EGRESS_IP`, `TRADING_DISABLED`, `DELTA_TRADING_REST_URL`, and five optional ones left empty.

## 3. Three places, one direction

```
 LAPTOP (build and test)       GITHUB (checks and packages)       SERVER (the real copy)
 write code on a branch  --->  pull request, checks run
                               merge to main
                               images built for that commit --->  the owner picks a commit:
                                                                  backup, pull, restart
```

- **Laptop**: where changes are made and tried. Its database is a practice copy.
- **GitHub**: checks every change and builds the four images for every commit of `main`.
- **Server**: runs the commit named by `RELEASE` in its settings file. Nothing reaches it by itself.

## 4. Releasing a new version

1. The change is merged to `main`. GitHub builds the images once the code checks pass (typecheck, lint, unit tests, build). They are built even when the e2e is red, so **look at the e2e result of that commit yourself** before choosing it.
2. On the server, try the new version on a copy of the live data first (section 6a). Go on only when it says `test-release PASSED`:
   ```
   cd /opt/hapiecoin/deploy
   sh test-release.sh <full commit id>
   ```
3. Then release:
   ```
   cd /opt/hapiecoin/deploy
   sh backup.sh
   nano .env        # set RELEASE= to the full commit id
   docker compose -f compose.prod.yml --env-file .env pull
   docker compose -f compose.prod.yml --env-file .env up -d
   ```
4. The site is away for a minute or two. Then check: every service healthy (`docker compose ... ps`), sign-in works, a paper trade shows its marks.

If the change touched a file in `deploy/`, copy that folder to the server again first (the repository is private, so the server cannot fetch it). If the change needs a new setting, add the line to `.env` by hand.

**To go back**: put the previous commit id in `RELEASE`, then `pull` and `up -d`. That is enough when the bad release changed nothing in the database; when it did, see the runbook §6.5.

## 5. The database

- **The server's database is the real one.** Users, trades and Autopilot history live there.
- **Changes to its design travel with the code.** A developer's change produces a numbered migration file; it is merged with the rest and packaged inside the api image; when that version is released, the api applies any migration it has not yet applied as it starts. Nobody runs anything by hand.
- **Only the design travels, never the data.** The laptop's rows never reach the server, and the server's rows never reach the laptop by themselves.
- **A merged migration is permanent.** The server cannot be reset. A clash of migration numbers is settled by renumbering the unmerged one.
- **Never restore the laptop's database onto the server again.** It was done once, on 27 Nov 2026; doing it again would erase everything since.
- **The two databases are different products.** Development runs a TimescaleDB image, the server plain PostgreSQL 17. The app uses nothing from TimescaleDB; a change that started to would work on the laptop and fail on the server.

### Backups
| Copy | Kept | How to use it |
|---|---|---|
| Azure's own backups | 14 days, any minute | A point-in-time restore in the Azure portal creates a new database server; `DATABASE_URL` is then pointed at it |
| The nightly dump on the server, 21:15 UTC | The last 14 files in `/var/backups/hapiecoin` | `sh restore.sh <file>` (runbook §6.3 and §6.5) |
| The dump taken before each release | Same folder | Same |

Not yet in place: a copy of the dumps off the server.

## 6. Working on the laptop

Development is as before: `pnpm db:up`, `pnpm dev`, against the local database. Three things changed on 27 Nov 2026:

- **Autopilot is still switched on in the local data.** Running the local app makes the laptop trade on paper too, apart from the server, and sends every alert twice if both use the same Telegram bot. Switch it off locally or accept that knowingly.
- **The local app sends real mail** through the same Resend account.
- **The real paper-trade record is now on the server.** The local database stopped collecting on 27 Nov 2026. Research reads the live database through its own read-only login (section 6b).

## 6a. The test database (ADR-153)

A second database, `hapiecoin_test`, sits beside the live one in the same database server. Nothing that runs uses it. One command on the server tries a release on it:

```
sh /opt/hapiecoin/deploy/test-release.sh <full commit id of main>
```

It takes a fresh dump of the live database, loads it into the test database (replacing what was there), starts that commit's api against the test database alone (trading off, background jobs off, no Redis, no Telegram, no port open) so that it applies its migrations there, and says whether it came up healthy and how many migrations it applied. The live database is only read; the running app is not touched.

- `test-release PASSED` means the new version's database changes apply to a copy of the real data and the api starts on the result. It does not open the screens.
- `test-release FAILED` prints the api's last lines. Do not release that commit.
- Avoid it at a settlement or while Autopilot is entering: it shares the database server's two CPUs with the live app for a few minutes.

## 6b. Research access to the live database (ADR-153)

For the review of what the strategies did: the users, the trades placed, the capital used, the profit and loss.

- A database login `research` that can only read. It has no right to change, add or delete anything, and none to create anything.
- It reads every table except `sessions`, `accounts`, `verifications`, `two_factors`, `passkeys`, `broker_credentials` (sign-in material and the encrypted exchange keys) and `payments`. It cannot connect to the test database.
- By default its transactions are read-only, a query is cut off after 30 seconds and it holds at most 3 connections. The first two are defaults the login could switch off for itself; what truly stops a write is that it was never given the right.
- It is created, and its password changed, by `sh /opt/hapiecoin/deploy/research-role.sh` on the server; the owner types the password. **Run it again after a release that adds a table**: a new table is not readable until then, on purpose.
- Its address is the live one with the login and password changed: `postgres://research:<password>@hapiecoin-db.postgres.database.azure.com:5432/hapiecoin?sslmode=require`. The password is the owner's to hand to the research session; it is not written in the repository.
- The database's firewall must allow the address research connects from. A home address changes: when research stops connecting, the rule is updated to the new address (Azure portal, `hapiecoin-db`, Networking).
- Known costs: the live database is reachable from one more place, and research shares its two CPUs. Large queries stay away from settlement times.

## 7. Planned, not built

Decided by the owner on 27 Nov 2026. Nothing below exists yet.

### 7.1 Watching the server
- An outside monitor (UptimeRobot's free plan was the pick: 50 monitors, every 5 minutes, a phone app) on `https://ws.hapiecoin.com/healthz`, alerting when the text `"socket":"open"` is missing, and on `https://app.hapiecoin.com/manifest.webmanifest`.
- Neither watches the api or the stop engine, which sit behind the gate. A public health address for those is a later change.
- An error tracker (the app needs only `ERROR_SINK_DSN`).

## 8. Before anyone trades real money

The copy runs with `TRADING_DISABLED=true` and its signed calls go to the exchange's testnet. Before that changes:

1. **Stops, targets and Autopilot run on the server.** While it is down none of them fires. The monitor in 7.1 comes first.
2. **Each trader whitelists `20.222.225.36`** at the exchange for their API key.
3. **Two money checks are unverified against the real exchange**: the margin estimate (GAPS #109) and the shape of the exchange's fill data. The owner trades a small size alone first.
4. **`TRADING_DISABLED` stops new live trades, not a close or a cancel** on a strategy that is already live (GAPS #186 j).
5. **Other people's money may carry legal duties in India.** `docs/research/autopilot-live-compliance.md` is research, not advice; a professional's opinion comes before others trade.

## 9. When something is wrong

| What you see | First look |
|---|---|
| The site does not load | `ssh hapie@20.222.225.36`, then `cd /opt/hapiecoin/deploy` and `docker compose -f compose.prod.yml --env-file .env ps`. A service that is not `healthy` is the place to start |
| A service keeps restarting | `docker compose -f compose.prod.yml --env-file .env logs <service> --tail 50`. The api names a missing or wrong setting in its first lines |
| Sign-in codes do not arrive | Resend's dashboard (Emails) shows each message and why it failed |
| The api cannot reach the database | In Azure, `hapiecoin-db` must be running and its firewall must list the server's address |
| The gate's password box keeps coming back | Seen once on 27 Nov 2026 and not explained (GAPS #186 b). Turn on Caddy's request log (the `log` line in the Caddyfile) to see which request is refused |
| Everything after a release is wrong | Go back: section 4 |

Restarting everything is safe: `docker compose -f compose.prod.yml --env-file .env restart`. Do not use `down -v`; `-v` deletes the certificates.
