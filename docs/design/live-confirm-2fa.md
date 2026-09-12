# Typed LIVE confirmation and the TOTP second factor — design pass (roadmap item 28, ADR-078, HC-TR-186, HC-PB-068, HC-SH-129)

1. **Job.** Make a real order and the account that can place one two deliberate acts: no live entry leaves the browser without the word LIVE typed into the dialog (and the API refuses one without it), and a trader can require a six-digit authenticator code at sign-in. First question answered in 2 s: *"Is this the real one?"* (the typed field sits under the red "Real Money Trading" block, and the button reads "Place live orders" only once the word is in).

2. **Layout.**
```
Trade Preview (live) footer                     Trade All → Live footer / Adjust confirm (live, with adds)
┌ … capital block · exchange check · mindful ─┐   same field, same rule; Adjust keeps Hold to place as the button
│ You are about to trade this strategy …      │
│ Type LIVE to place    [ LIVE   ]             │  ← one field, mono, uppercase, autoFocus when the pause ends
└──────────────────────────────────────────────┘
                    [ Cancel ]  [ Place live orders → ]  ← destructive, disabled until the field reads LIVE
Retry failed orders (card): a small dialog · "Re-send N refused entry orders on <exchange>" · the same field · [ Retry → ]

Sign-in, second step (10-public: HC-PB-068)                Settings → Security (00-chrome: HC-SH-129)
┌ Two-factor code ───────────────────────────┐   ┌ Security ─────────────────────────────────────────┐
│ Enter the 6-digit code from your           │   │ Two-factor sign-in            [ off ]  [ Turn on ] │
│ authenticator app                          │   │ ── turning on ──                                    │
│ [ _ _ _ _ _ _ ]  (OtpInput)                │   │ 1 Your password  [••••••••]                         │
│ [ Verify → ]   Use a backup code instead   │   │ 2 Add HapieCoin to your authenticator: the key      │
└────────────────────────────────────────────┘   │   JBSW Y3DP EHPK 3PXP  [Copy]  (or open the link)   │
                                                 │ 3 Enter the first code  [ _ _ _ _ _ _ ]  [Verify]   │
                                                 │ ── after verify: 10 backup codes, shown once, [Copy]│
                                                 │ ── when on: [ Turn off ] (password + code)          │
                                                 └─────────────────────────────────────────────────────┘
```
Narrow (390): the typed field and the button stack full width; the Security steps are already one column.

3. **Hierarchy.** The typed field is secondary text with a mono input; the destructive button stays the one primary of each dialog and is disabled, not hidden, until the word is in (the trader sees what they are unlocking). In Security the only primary is the current step's button. Red only on the existing "Real Money Trading" block and the destructive buttons; green nowhere new.

4. **States.** *Field empty / wrong*: button disabled, no error text (the label says what to type; a wrong word is just not LIVE); *typed*: button enabled; *submitting*: button loading, field disabled; *server refuses without the word* (a stale client): the error toast reads the server's sentence "Type LIVE to confirm a real order". *Mindful pause running*: the countdown replaces the button; the field is shown so the trader can type during the pause; when the pause ends the button returns disabled until LIVE is in. *Paper*: no field. *Exits, square-offs, partial exits*: no field (they reduce risk; ADR-074's line). *Retry*: the dialog lists the refused legs from the card, then the field. **TOTP:** *sign-in with 2FA on*: password or email-OTP step succeeds → the code step (no session until it passes); *wrong code*: "That code is not right" under the boxes; *locked* (the plugin's counter): the plugin's message; *backup code*: a text field instead of the boxes; *enable step 1 wrong password*: inline error; *enable step 3 wrong first code*: inline error, the secret stays; *disable*: password + a current code. *Providers*: Google and Delta hand-off land in the same code step when the account has 2FA on. *Passkey*: not offered in the web today (GAPS #12 stands).

5. **Numbers / copy.** The typed word is exactly `LIVE` (case-insensitive on input, shown uppercase). Backup codes: 10 codes, shown once, "copy all", with the sentence "Each code works once; keep them where you keep your passwords". The secret is shown in groups of four for manual entry, with the otpauth link as a copyable line (no QR image: it would need a library the repo does not have; GAPS row).

6. **Interaction.** Focus: the typed field takes focus when the preview opens (or when the pause ends); Enter in the field with LIVE typed presses the button. Sign-in code step: the six boxes autofocus, paste fills them, Enter submits. Security: the menu row "Security" (settings menu, value "2FA on" / "2FA off"), palette "Open Security", DialogKind `security`. No new shortcut.

7. **Traceability.** HC-TR-186 typed LIVE confirmation on every live entry (preview, batch, adjust with adds, retry) and the API's refusal without it; HC-PB-068 the TOTP step at sign-in (password and OTP paths, backup codes); HC-SH-129 Security settings (enable with the first code, backup codes once, disable). Functional: `trading-live.test.tsx`, `AuthForms.test.tsx`, `dialogs.test.tsx`, api `live.test.ts` / `strategies.test.ts` / `auth.test.ts`; e2e `analyse.spec.ts` live section (typed word threaded through HC-TR-063 / HC-TR-152), `auth.spec.ts` (2FA sign-in), `settings.spec.ts` (Security).

8. **Real-data check.** Long strategy names or 20-leg batches change nothing (one field per dialog). 6-digit codes only. Failure breakpoint: none new; the field is 8 ch wide.

9. **Generic-pattern check.** One field, one word, one button, in every live dialog the same; no checkbox ("I understand"), no second modal. The Security dialog is three numbered steps because enrolment has three acts.

10. **Confusion check.** (a) "Why is the button grey?" → the label "Type LIVE to place" sits directly above it and the field is focused. (b) "Is this the pause again?" → the pause is a countdown button; the typed field is a text field with its own label; they never overlap in meaning. (c) "Where do I put the key?" → the Security step names the authenticator app, shows the key in groups of four and the link, and asks for the first code before anything changes on the account.
