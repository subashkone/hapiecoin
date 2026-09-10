# Alerts (Phase 5 item 2, ADR-052)

Traceability: HC-SH-079, HC-SH-094..100 (shared chrome · Alerts center), HC-TR-114, 117, 120, 139 (Set alert on cards and Details). Reference captures: `mockup-v2/shots/v2-chrome-alerts-dialog*.png`, `-form`, `-triggered`, `v2-trading-alert-*.png`.

## 1. Job
Tell the trader when the futures price, the ATM implied volatility or a strategy's P&L crosses a level they set, without them watching the screen. First question in two seconds: "which of my alerts are armed, and did one fire?" — the bell badge answers it (count; red when one fired).

## 2. What an alert is
`packages/schema/src/alerts.ts`. Kind `price` (futures price, USD) · `iv` (ATM IV of the nearest listed expiry, vol points %) · `pnl` (a paper or live strategy's total P&L, USD). Condition `>=` "at or above" / `<=` "at or below" a value. Channels `push` (in-app toast + browser notification when permitted) and/or `email` (Resend). State `armed` → `triggered` (with `lastValue`, `triggeredAt`) → re-armed from the switch; `paused` from the switch. Up to 50 per user. P&L alerts snapshot the strategy name so the row still reads after the strategy is archived. Telegram is shown as a disabled "soon" channel (GAPS #64). IV *rank* waits for the IV history (GAPS #62): the alert compares the ATM IV level.

## 3. Where it runs
- **Server** (`apps/api/src/routes/alerts.ts`, table `alerts`, migration 0010): CRUD per user, `POST /v1/alerts/{id}/trigger` records the reading, marks triggered and mails the email channel (a bounced mailbox is logged, never undoes the trigger). Audit: `alert.create`, `alert.delete`, `alert.trigger`.
- **Client engine** (`apps/web/src/lib/alerts/AlertEngine.tsx`, mounted once in the header while signed in): reads the three spot topics, an `IvProbe` per asset that has an IV alert (nearest expiry chain → `atmIvOf`), and the paper book of the active strategies when a P&L alert exists; evaluates the armed alerts with a 1 s trailing throttle and posts each hit. Readings are published to a tiny external store (`readings.ts`) so the dialog shows "now …" on every row and on the form.
- Evaluation only happens while a HapieCoin tab is open (the client holds the feed); server-side evaluation for a closed app is GAPS #64.

## 4. Layout (dialog, 860 px)
```
Alerts                                                             ×
Price, ATM IV and strategy P&L alerts · in-app push or email
3 alerts · 2 armed · 1 triggered                        [New alert]
┌ New alert form (when open) ─────────────────────────────────────┐
│ Type ▾          Asset ▾ | Strategy ▾          Condition ▾        │
│ Value · USD  now 79,506.5   [81000]   Channels ☑ push ☐ email ☐ telegram soon │
│                                              [Cancel] [Save alert] │
└──────────────────────────────────────────────────────────────────┘
[↗] BTC ≥ 82,000.0            PUSH        armed     (●)   ✕
    Price · now 79,506.5
[~] BTC ATM IV ≤ 30.0%        EMAIL       triggered (●)   ✕      ← warning border, "· fired 3:14 PM"
    ATM IV · now 42.4% · fired 3:14 PM
[%] Bull Call Spread · P&L ≥ +$20.00   PUSH EMAIL  armed (●) ✕
Evaluated on every price tick while HapieCoin is open · …     [Close]
```
Empty: "No alerts yet" + New alert. Delete asks once inline (Delete / Keep). The switch pauses an armed alert and re-arms a paused or triggered one; re-arming with the condition still met fires again at once.

## 5. Entry points
Header bell (`alerts-bell`, both header variants; badge `alerts-badge` = armed count, or the triggered count in red), settings menu "Alerts · N armed" (`menu-alerts`), palette "New alert…" (`act:alert-new`) and "Alerts center" (`act:alerts`), "Set alert" on every paper and live card (`card-alert`) and in Strategy Details (`details-alert`) → `store.openAlerts({ kind: "pnl", strategyId, asset })` opens the form with the strategy chosen (HC-SH-100, HC-TR-139).

## 6. Test ids
`alerts-dialog` (data-count) · `alerts-counts` · `alerts-new` · `alerts-empty` / `alerts-empty-new` · `alert-form` · `alert-kind` · `alert-asset` | `alert-strategy` · `alert-op` · `alert-value` · `alert-form-now` · `alert-ch-push` / `alert-ch-email` · `alert-save` / `alert-cancel` · `alert-row` (data-state, data-kind) · `alert-condition` · `alert-now` · `alert-channel` · `alert-state` · `alert-arm` · `alert-delete` / `alert-delete-confirm` · `alerts-bell` (data-armed, data-triggered) · `alerts-badge`. Visual: `analyse-alerts-{theme}.png`, `analyse-alerts-form-{theme}.png`.

## 7. Amendment · server-side evaluation and Telegram (11 Sep 2026, ADR-057)
The API evaluates armed alerts after every IV snapshot (`alerts-evaluate.ts`), so they fire with the app closed; both paths share `fireAlert`. The Alerts center gains a Telegram row (`telegram-status` with `data-state` loading / off / unlinked / pending / linked): Connect issues a code and the bot deep link (`telegram-link`, `telegram-code`), the API's long-poll links the chat on `/start <code>`, Send test (`telegram-test`) and Disconnect (`telegram-unlink`). The form's telegram checkbox (`alert-ch-telegram`) enables once linked. Routes: `GET /v1/me/telegram`, `POST /v1/me/telegram/link`, `DELETE /v1/me/telegram`, `POST /v1/me/telegram/test`. Env: `TELEGRAM_BOT_TOKEN`.
