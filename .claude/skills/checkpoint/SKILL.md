---
name: checkpoint
description: Save session state to files before compaction or end of session. Updates activeContext.md, records new decisions as ADRs, adds gaps, refreshes the knowledge graph, and summarises what to carry forward. Use after a milestone, before /compact, or when context is getting long.
argument-hint: [optional one-line summary of what just happened]
allowed-tools: Read, Edit, Write, Bash(git status *), Bash(git diff --stat *), Bash(graphify *)
---
Summary hint: $ARGUMENTS

## Snapshot
- Working tree: !`git status --short 2>&1 | head -30`

## Steps
1. Update `.claude/memory/activeContext.md`: set **Last updated** to today, rewrite **Current phase**, add a dated line under **Recent**, refresh **Blocked by** and **Next steps** (numbered, the first one is what to do immediately in the next session). Keep it under 40 lines; move older "Recent" lines out.
2. For every decision made in this session that is not yet in `docs/DECISIONS.md`, append an ADR with the next number, today's date, context, decision, consequences. Ask the user before recording anything they only floated as an idea.
3. For every review finding or missing feature discovered, add a row to `GAPS.md` with source and status `open`.
4. If `.claude/memory/systemPatterns.md` or `productContext.md` is now stale (new stack choice, new convention), fix the specific line.
4b. If `.claude/memory/workingState.md` exists (an open `/debug-loop`), fold its current error and next step into **Next steps** of activeContext; delete it if the loop is finished.
5. If code or docs changed, run `graphify update .` so the knowledge graph includes them (skip if the command is missing, and say so).
6. Print a 5-line hand-off: what was done, what is verified, what is unverified, what is next, which files you updated. Then suggest `/compact` if the session is long.

Do not touch anything outside these files.
