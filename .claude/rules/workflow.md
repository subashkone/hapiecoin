# Working agreements

- **Plan before multi-file work.** Use `/plan` or plan mode. The plan names files, traceability IDs, and what will be verified. Edits start only after agreement. Skip it only when you could describe the diff in one sentence (typo, label, constant).
- **Keep the signal, drop the noise.** Run tests, QA, builds and log reads through `/digest` (isolated subagent, compact summary back). In a debugging loop keep the working record with `/debug-loop`: files changed, current error, suspected cause, what is confirmed, next step. Never paste a full stack trace, snapshot or test log into the main conversation more than once.
- **Memory is a map.** `.claude/memory/*` and auto-memory tell you where to start; verify paths, commands and symbols against the current repo before editing based on them, and fix the memory file when it is stale.
- **Record, do not just say.** New decision: ADR in `docs/DECISIONS.md` (next number, dated). Review finding: row in `GAPS.md`. Status change: `.claude/memory/activeContext.md` via `/checkpoint`.
- **Cite evidence.** When reporting what code does, give `file:line`. When reporting a run, quote the command and the tail of its output.
- **Stay in scope.** Do the request, whole; do not widen it. Flag concerns in one or two sentences and continue.
- **Prefer project tools.** Ask structure questions through `/graphify` before grepping the mock bundles (they are megabytes).
- **Long sessions.** After a milestone run `/checkpoint`, then `/compact`. Keep tool output short (`| tail`, `--pretty false`, `head_limit`).
- **Git.** No commit or push unless asked; `/commit` runs the commit workflow. Never force-push, never `reset --hard` (hook-enforced).
