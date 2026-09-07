# HapieCoin · Claude Code environment

Set up 2026-09-07 (ADR-009). This folder is configured so Claude Code behaves like a team member who has read the docs, follows the rules, and cannot make a claim without evidence. The design merges four public write-ups with the current Claude Code docs:

| Source | Idea taken | Where it lives here |
|---|---|---|
| Rajesh Nekkanti, *My Claude Code Setup* | CLAUDE.md is a router, not a manual; memory split into product / system / active context; rules with constraint + consequence + correct approach; personas; commands | `CLAUDE.md` (39 lines), `.claude/memory/*`, `.claude/rules/*`, agents, skills |
| AI Engineering, *Four layers to stop hallucinating* | Honesty rules in the first 50 lines; verification protocol; hooks that feed type/lint/test output straight back; a fact-checker subagent | `CLAUDE.md` top two sections, `post-edit-check.js`, `stop-check.js`, `.claude/agents/fact-checker.md` |
| Youssef Hosni, *6 skills for real projects* | Skill creator (only for processes repeated 3+ times), planning (restate, inspect, plan, tests, wait), context management (compress noisy output, keep a working record), memory as a verified map, review as a draft check (requirement match, edge cases, meaningful tests, maintainability, depth by risk), frontend design (purpose, hierarchy, states, real data, existing design system) | `/new-skill`, `/plan`, `/digest` + `/debug-loop`, memory files + `/checkpoint`, `/review` + `code-reviewer`, `/frontend-design` |
| Abhishek Agarwal, *Anthropic's 4-part setup* | Lean CLAUDE.md with commands, etiquette and env vars; explore, plan, implement, commit; a check Claude can run (Stop hook, verification subagent); skills, subagents, MCP, hooks; scale with worktrees and a writer/reviewer split | `CLAUDE.md` (repo etiquette section), `/plan` and `/commit`, `stop-check.js` + `fact-checker`, skills/agents/hooks, "Scaling up" below |

All four articles were read in full (the two member-only ones were supplied by the user on 2026-09-07) and checked line by line against this setup.

## Layout

```
CLAUDE.md                      router: honesty rules, verification protocol, commands, pointers, non-negotiables
.claude/
  settings.json                permissions (allow/deny) + hooks   (shared, commit it)
  settings.local.json          your personal permission grants    (gitignored)
  memory/
    productContext.md          what and for whom (changes rarely)
    systemPatterns.md          stack, conventions (changes on architecture decisions)
    activeContext.md           where we are, blockers, next steps (changes often; injected at session start)
    workingState.md            open debug loop record (gitignored, exists only while /debug-loop is active)
  rules/
    product-identity.md        always loaded
    workflow.md                always loaded
    typescript.md              loads when editing apps/** or packages/** .ts/.tsx
    trading-safety.md          loads for apps/api, gateway, workers, packages/venues
    frontend.md                loads for apps/web, packages/ui
    mock-builds.md             loads for mockup-v2, mockup-clone
    testing.md                 loads for test files
  agents/
    fact-checker.md            verifies claims; writes no code (sonnet)
    code-reviewer.md           read-only review with project memory
  skills/
    plan, digest, debug-loop, review, commit, checkpoint, frontend-design, new-skill
  hooks/
    session-start.js           injects activeContext + latest ADRs + open gaps + git state
    guard-files.js             denies edits to mockup-clone/, .env*, generated v2 HTML
    guard-bash.js              denies rm -rf on roots, force push, reset --hard, clean, DROP TABLE, Delta order calls
    post-edit-check.js         tsc / eslint / node --check / JSON / py_compile on the file just written; brand check
    stop-check.js              runs the test script on code changes and blocks a red finish; warns on stale v2 build
    test-hooks.js              self-test: node .claude/hooks/test-hooks.js
docs/DECISIONS.md              ADR log (source of truth for decisions)
GAPS.md                        review backlog
spec/                          build spec + traceability
```

## The daily loop

1. **Start** a session in this folder. The SessionStart hook prints the active context; `/graphify` answers structure questions from the knowledge graph.
2. **Plan**: `/plan <task>` (or Shift+Tab plan mode). No edits until you say "go".
3. **Implement**. Every edit is checked by the PostToolUse hook; errors come back into the conversation immediately. Claude must cite `file:line` and may only say "tests pass" after running them. Noisy commands go through `/digest` (runs in a forked subagent, returns a summary under 40 lines). If a fix takes more than two attempts, `/debug-loop <topic>` keeps a compact record (files changed, current error, ruled out, suspected cause, next step) that survives compaction; `/debug-loop close` files anything durable and deletes it.
4. **Review**: `/review` runs the code-reviewer and fact-checker subagents and merges their reports.
5. **Commit**: `/commit` (user-only skill) rechecks secrets, product name, mockup-clone, unverified markers, then commits. Add `push` to push.
6. **Checkpoint**: `/checkpoint` updates `activeContext.md`, appends ADRs and gaps, refreshes the graph. Then `/compact`.

## Hooks: what fires when

| Event | Matcher | Script | Effect |
|---|---|---|---|
| SessionStart | all | session-start.js | additionalContext with state |
| PreToolUse | Edit, Write, MultiEdit, NotebookEdit | guard-files.js | deny protected paths |
| PreToolUse | Bash, PowerShell | guard-bash.js | deny destructive commands |
| PostToolUse | Edit, Write, MultiEdit | post-edit-check.js | additionalContext with errors only |
| Stop | all | stop-check.js | runs `pnpm test` / `npm test` if a root test script exists and code changed; `decision: block` on failure |

Hooks are Node scripts (no jq or bash dependency) so they run the same in PowerShell and Git Bash. Test them after any change:

```
node .claude/hooks/test-hooks.js
```

Hooks are enforced by the client; CLAUDE.md and rules are guidance. Put "must never happen" items in hooks or `permissions.deny`, everything else in rules.

## Permissions

`.claude/settings.json` pre-approves read-only git, the project build/QA commands, `pnpm test|lint|typecheck|build`, `npx tsc|eslint|vitest|playwright`, and `graphify`. It denies reading or editing `.env*`, editing `mockup-clone/`, force push and `reset --hard`. Add personal grants to `settings.local.json`; run `/fewer-permission-prompts` after a few sessions to harvest more allow rules.

## Extending

- Same correction typed twice → add a line to a rule file (with the why).
- Same procedure typed twice → `/new-skill <name> <purpose>`.
- Something must never happen → hook or deny rule, then a test case in `test-hooks.js`.
- New stack or convention → edit `systemPatterns.md` and record an ADR.
- When `apps/` exists: add `tsconfig.json` and an eslint config so `post-edit-check.js` starts type-checking; add a root `test` script so `stop-check.js` starts running tests.

## Scaling up (once the single-agent loop is boring)

- **Writer / reviewer split.** The `code-reviewer` subagent already reviews in a fresh context. For a stronger split, open a second Claude Code session (or `claude -p "/review staged"` from another terminal) that has not seen the implementation and let it review the diff.
- **Parallel work in worktrees.** Give each feature its own git worktree (`git worktree add ../hapie-feat-x feat/x`) and run one session per worktree; the `.claude/` folder travels with the checkout, and subagents accept `isolation: worktree`.
- **Batch jobs.** For mechanical changes across many files, loop `claude -p "<task for file>"` over the file list, then run `/review deep` once on the combined diff.
- **Unattended runs.** Only after the Stop hook has a real test script to run. Auto mode plus a red test suite is the fastest way to ship broken code.
- **Screenshots as a check.** `node qa.js dark|light` in `mockup-v2` writes shots; when `apps/web` exists, Playwright visual diffs against the spec tolerance become the pass/fail the agent reads.

## Not set up (deliberately)

- MCP servers (Serena, Playwright MCP, Postgres). Add them per app once the monorepo exists; the hapie-product setup has working configs to copy.
- CI. The Stop hook is the local gate; GitHub Actions or Azure Pipelines come with the monorepo scaffold.
- Global `~/.claude` changes. Everything here is project-scoped so it travels with the repo.


## Local environment notes (07 Sep 2026)
- Docker Desktop on Windows 11 Home needs WSL 2. If `wsl --status` says virtualization is not enabled while firmware virtualization is on, the fix is `bcdedit /set hypervisorlaunchtype auto` (elevated) plus the VirtualMachinePlatform and Microsoft-Windows-Subsystem-Linux features, then a restart.
- Toolchain pins: Node 24, pnpm 12 via corepack, TypeScript 6.0.3 (ADR-011). API tests run on PGlite with 2 forked workers (each file boots its own WASM Postgres).

### Docker on this machine (state as of 07 Sep 2026, 08:20)
- Windows 11 Home 24H2 (26100.6584). Virtual Machine Platform is a feature-on-demand here: enabling it needs a payload from Windows Update.
- Findings: CPU virtualization on; `hypervisorlaunchtype` was unset (fixed to `auto`); the ISP DNS (49.205.72.130 / 183.82.243.66) mapped `*.delivery.mp.microsoft.com` to a G-Core edge that fails TLS, so Windows Update stalled at 50 % with 0x80240021. Adapter DNS was switched to 1.1.1.1 / 8.8.8.8 (revert with `Set-DnsClientServerAddress -InterfaceAlias Wi-Fi -ResetServerAddresses`, same for Ethernet). Fast Startup was disabled (`powercfg /h off`) so restarts complete servicing.
- Delivery Optimization keeps a stalled 3.46 GB download; it does not re-resolve DNS until `DoSvc` and `wuauserv` are restarted (elevated). The feature enable then failed with 0x8000ffff and left VirtualMachinePlatform "Disabled with Payload Removed"; `wsl --install --no-distribution` fails with WSL_E_INSTALL_COMPONENT_FAILED until the payload downloads.
- To finish: elevated `Restart-Service DoSvc -Force; Restart-Service wuauserv -Force`, then `dism /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart` (or `wsl --install --no-distribution`), confirm `C:\Windows\System32\vmcompute.exe` exists, restart Windows, open Docker Desktop, `pnpm db:up`.
- 07 Sep 2026 09:35–09:51: after the 25H2 download finished (DNS fix), the elevated helper `%TEMP%\hapiecoin-elevated-fix3.ps1` re-ran the enable. The direct `dism /enable-feature` call staged the payload but ended with 0x80073712 (ERROR_SXS_COMPONENT_STORE_CORRUPT); the follow-up `wsl --install --no-distribution` in the same run then reported "The operation completed successfully" at 09:51 on 07 Sep 2026 with a reboot pending (CBS RebootPending set, pending.xml present). An earlier attempt at 08:58 was killed by a user-initiated Windows Update restart at 09:04.
- If servicing misbehaves later, run elevated `dism /online /cleanup-image /restorehealth` then `sfc /scannow` (the 0x80073712 above says the component store has an inconsistency).
- 07 Sep 2026 10:00–10:30, after the reboot: VirtualMachinePlatform is Enabled, `vmcompute` runs, WSL 2.7.13 (kernel 6.18.33) is current, but every WSL 2 VM start fails with `Wsl/Service/RegisterDistro/CreateVm/0x800705b4` (timeout) after ~30 s, so Docker Desktop cannot import its `docker-desktop` distro. WSL debug console (`.wslconfig`: `debugConsole=true`, `debugConsoleLogFile=...`) shows the kernel booting in 0.7 s and then `UtilConnectVsock:610: connect port 50000 failed 110`: the Linux init cannot reach the host WSL service over the Hyper-V socket. Hyper-V Worker/Compute logs show the VM created and started normally. Ruled out: IFEO mitigation overrides, Winsock catalog (all Microsoft), missing Hyper-V driver files, WSL `safeMode`. The WSL installer registers nothing under `GuestCommunicationServices` (checked msipackage/package.wix.in), so that key is not the cause. Reported fixes tried: `Restart-Service hns, vmcompute, WSLService` (no change); `HypervisorPlatform` feature enabled (reboot pending, elevated helper `%TEMP%\hapiecoin-elevated-diag.ps1`). Still suspect if that fails: McAfee (`mfesec.sys` boot driver, McAfee 1.40 + WebAdvisor installed on this ASUS TUF A15).
- 07 Sep 2026 10:30–11:00: `HypervisorPlatform` enabled + reboot: no change. The 6.6 kernel from WSL 2.6.3 (via `.wslconfig` `kernel=`/`kernelModules=`) fails identically, so the kernel is not the cause. Running non-Microsoft kernel drivers: McAfee `mfesec.sys` (boot start, "McAfee Windows Protection Suite" 26.5; Defender real-time is off, McAfee is the active AV), `AMDRyzenMasterDriver.sys` (Armoury Crate), `amdfendr.sys`, ASUS/NVIDIA/MediaTek/Realtek device drivers. Next isolation step needs the user: turn McAfee protection off (or uninstall it) and retry `wsl --import-in-place`; if still failing, stop Armoury Crate + the Ryzen Master driver. `.wslconfig` currently keeps `debugConsole=true` writing to `%LOCALAPPDATA%\Temp\claude\wsl-console.log`; delete the file to return to defaults.
- Compose verification (07 Sep 2026, after the 25H2 fix): `docker compose ps` shows `hapiecoin-postgres` (timescale/timescaledb:latest-pg17) and `hapiecoin-redis` (redis:7-alpine) healthy on 5432/6379. Against them: `pnpm exec tsx src/db/migrate-cli.ts` applied the migration; API `/healthz` `db: postgres`; email-OTP sign-in created a user + session (`select count(*)` via `docker exec hapiecoin-postgres psql`), `/v1/me` 200; OTP send limit 429 on the 6th request with `hc:rl:*` keys in the compose Redis; gateway with `pubsub: redis` published on `hapiecoin:gw:*` channels and a WebSocket client received a 31-row snapshot plus q/spot/pong frames. ADR-013 Docker path closed. Dev tip: the OTP send limit is per IP (5 per 15 min); clear with `docker exec hapiecoin-redis redis-cli del hc:rl:otp:send:ip:unknown` when testing locally.
- Images (07 Sep 2026): `docker build -f apps/gateway/Dockerfile -t hapiecoin-gateway .` (247 MB, ~25 s) and `docker build -f apps/api/Dockerfile -t hapiecoin-api .` (403 MB, ~25 s) both build from the repo root. Smoke tests: the gateway container answered `/healthz` with 895 live instruments and reported `healthy`; the API container ran on the compose network (`--network hapiecoin_default`, `DATABASE_URL=postgres://hapiecoin:hapiecoin@postgres:5432/hapiecoin`, `REDIS_URL=redis://redis:6379`) with `db: postgres`, `redis: true`. In production mode the API refuses to boot without `CREDENTIALS_ENC_KEY` (32 bytes, base64) and `BETTER_AUTH_SECRET`; generate throwaway values for local image tests, never commit them. Two fixes were needed: a root `.dockerignore` (without it `COPY apps/api` brought the host's pnpm-symlinked `node_modules` into the image and broke the compile) and pnpm 12 syntax in `apps/api/Dockerfile`.
- ADR-019 changed two production defaults (07 Sep 2026, after the Phase 1 review): the API image now refuses to boot in production without `DATABASE_URL` and `RESEND_API_KEY` (pass a dummy `RESEND_API_KEY=re_dummy` for a local image smoke test; OTP mails will then fail at send time, which is the intended failure), and `BETTER_AUTH_URL` defaults to `WEB_URL`. Client IPs come from the socket unless the peer is in `TRUSTED_PROXY_IPS`; the API container behind the compose network sees the web proxy's address, so list it there in real deployments.
- Native Postgres/Redis verification (07 Sep 2026 10:50–11:00), no Docker: portable PostgreSQL 17.9 (EDB zip) extracted to `%LOCALAPPDATA%\Temp\hc\pgsql`, cluster `%LOCALAPPDATA%\Temp\hc\pgdata` (user/password/db `hapiecoin`, port 5432, 127.0.0.1 only); Redis 8.10.1 (redis-windows msys2 build) in the session scratchpad on 127.0.0.1:6379 with persistence off. Results: `pnpm exec tsx src/db/migrate-cli.ts` applied the migration (10 tables); API `/healthz` reports `db: postgres`; email-OTP sign-in created a user + session in Postgres and `/v1/me` read it back; the OTP send limit returned 429 on the 6th request with keys `hc:rl:*` in Redis; the gateway started with `pubsub: redis`, published on `hapiecoin:gw:chain:delta_india:BTC:<expiry>` and `hapiecoin:gw:spot:BTC`, and a WebSocket client received snap (20 rows), q, spot and pong frames. Start again with `pg_ctl -D <pgdata> start` and `redis-server --port 6379 --bind 127.0.0.1 --save ""`; stop with `pg_ctl -D <pgdata> stop` and `redis-cli shutdown nosave`. These live in temp folders and are not part of the repo; the Docker compose path remains the documented one (ADR-013).
- 07 Sep 2026 11:00–12:00 (second pass, ETW-based): `hvsocket.sys` is loaded (pulled in as an import of `vmbusr.sys`; it has no service key by design) and a user-mode AF_HYPERV bind+listen on the vsock port 50000 template GUID succeeds, so the host socket transport exists. An ETW trace (`diagnostics/wsl.wprp` profile `WSL-HvSocket`, plus a second run with the Hyper-V Hypervisor/VmbusVdev/VID/Worker providers) of `wsl --import-in-place docker-desktop` shows: wslservice binds port 50000 for the VM (`VmbusTlProviderListen`, transient service `0000c350-facb-…`, partition id matches the HCS VM id) and waits 30 s; the guest kernel opens its PCI and storage VMBus channels normally, init sends the vsock connect, and the host `Microsoft.Windows.HyperV.Socket` provider logs **no** inbound connect, offer, rescind or rejection at all (only a `Pausing partition` at VmbResume and a `Resuming partition` 1.03 s later, the same millisecond init started). No McAfee/AMD/NTSTATUS errors in either trace. Ruled out today: WSL service 2.6.3 (MSI from github.com/microsoft/WSL, same failure as 2.7.13, now installed until `wsl --update`), `.wslconfig` `nestedVirtualization=false`/`gpuSupport=false`/`networkingMode=none`, `kernelCommandLine` boot delays (ignored, init still at 0.75 s), `dism /restorehealth` + `sfc /scannow` (both clean, 0 components repaired), IFEO mitigations on vm*/wsl*, `Restart-Service vmcompute/WSLService`. `AMDRyzenMasterDriverV19` (Armoury Crate 5.1.4) rejects stop requests, so it can only be tested by disabling it and rebooting. Still untested and needing the user: disable the Ryzen Master driver + reboot; remove McAfee (MCPR) + reboot; Windows in-place repair (Settings > System > Recovery > "Fix problems using Windows Update"). Prepared helper: `%TEMP%\claude\…\scratchpad\hapiecoin-elevated-fix-ryzen.ps1`. Traces kept in the same scratchpad (`wsl-trace.etl/.xml`, `hv-trace.etl/.xml`).
- 07 Sep 2026 12:00–12:10: option 1 tested: `AMDRyzenMasterDriverV19` disabled + reboot, driver confirmed not loaded, same failure; reverted to Manual start and running. A third trace with the `vmbusr.sys` TraceLogging provider (GUID `2ed5c5df-6026-4e25-9fb1-9a08701125f3`, read from the driver binary 18 bytes before its provider name; `vmbus-trace.etl/.xml` in the scratchpad) shows the guest's channel opens arriving at the host normally, then no VMBus or HvSocket event at all from init start until teardown 29 s later: the guest's TL connect message (which the guest posts successfully, otherwise it would fail fast instead of timing out) is not delivered to `vmbusr`/`hvsocket`. That is inside the Windows hypervisor/root VMBus message path. Remaining options: remove McAfee (quick, reversible), then Windows in-place repair (Settings > System > Recovery > Fix problems using Windows Update).
- 07 Sep 2026 12:40–13:00: McAfee uninstalled by the user + reboot (no `mfe*` drivers loaded, Defender active): same failure. Root-cause lead found afterwards: the OS is on 24H2 build 26100.6584 (the September 2025 cumulative level) and the Windows Update history shows every cumulative/feature install since April 2026 failing with delivery errors (0x80240034, 0x80246007, 0x80246010, and one 0x80242016 "unexpected state after reboot", i.e. a partially applied then rolled-back update); 24H2 and 25H2 installs on 07 Sep aborted with 0x8024000B. WinSxS holds staged manifests at 26100.8115/8328 that were never committed. So the Hyper-V/VMBus stack is a year stale with leftovers of failed servicing; the pending "Windows 11, version 25H2" (KB5121003) is the fix to try before an in-place repair. The Windows Update agent install run (`hapiecoin-elevated-wu-install.ps1` in the scratchpad) was blocked by the Claude Code permission layer, so the user installs it from Settings > Windows Update, reboots, then retries `wsl --import-in-place docker-desktop`.
- **RESOLVED 07 Sep 2026 ~14:00.** The user installed "Windows 11, version 25H2" from Settings (build 26200.9168) and rebooted. `wsl --import-in-place docker-desktop` then completed in 3 s, Docker Desktop 4.89 started its engine (29.7.2) in 10 s, and `pnpm db:up` brought up `hapiecoin-postgres` (timescaledb pg17) and `hapiecoin-redis` both healthy (`pg_isready` accepting connections, `redis-cli ping` PONG). Root cause: the Hyper-V/VMBus host stack was stuck on the September 2025 servicing level with leftovers of rolled-back cumulative updates (delivery failures since April 2026); the guest's vsock connect message was dropped inside that stale host path. Nothing else changed the outcome: WSL versions, kernels, `.wslconfig` variants, DISM/SFC, Ryzen Master driver, McAfee (removed anyway; Defender is now the AV). Cleanup done: `.wslconfig` debug-console entries removed, Ryzen Master driver back to Manual, WSL on 2.7.13. Diagnostic traces and helper scripts stay in the 07 Sep session scratchpad only.
- Fallback if Windows Update stays blocked: install PostgreSQL 17 and a Redis-compatible server natively on Windows and point `DATABASE_URL` / `REDIS_URL` at them; the code path is identical (ADR-013).
