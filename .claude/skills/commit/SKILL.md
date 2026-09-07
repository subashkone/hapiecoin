---
name: commit
description: Review the working tree, verify claims, and create a well-formed git commit. User-invoked only. Never pushes unless asked.
disable-model-invocation: true
argument-hint: [optional message hint or "push"]
allowed-tools: Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git add *), Bash(git commit *), Bash(git push *), Read, Grep, Agent
---
## Current state
- Status: !`git status --short`
- Staged and unstaged diff summary: !`git diff HEAD --stat`
- Last commits: !`git log --oneline -5`

## Steps
1. Read the full diff (`git diff HEAD`). If it is empty, say so and stop.
2. Refuse to commit if any of these appear in the diff, and say which: `.env*` files, API keys or tokens, changes under `mockup-clone/`, generated `mockup-v2/hapiecoin-v2*.html` without a matching source change, `// UNVERIFIED` markers, the word "CoinGreeks" in HapieCoin code or copy.
3. If the diff touches code (not only docs), run the `fact-checker` subagent on the claims made about this change. Any WRONG result: stop and report; do not commit.
4. If a new decision was made in this work, confirm it is in `docs/DECISIONS.md`; if a gap was found, confirm it is in `GAPS.md`.
5. Stage only the files that belong to this change (`git add <paths>`, never `git add -A` when unrelated files are dirty).
6. Commit message: imperative subject under 72 chars with the traceability IDs when relevant, e.g. `feat(chain): drive strikes from instrument list (HC-CH-012)`; body with the why and the verification you ran; last line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
7. Push only if $ARGUMENTS contains "push", and never with `--force`.
8. Print the commit hash and the one-line subject.
