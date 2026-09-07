---
name: debug-loop
description: Keep a compact working record during a multi-step debugging or fix loop so the session stays usable and survives compaction. Use when an error takes more than two attempts, when tests keep failing, or when many tool outputs are piling up.
argument-hint: [what you are debugging, or "close" when done]
allowed-tools: Read, Write, Edit, Bash(git status *), Bash(git diff --stat *)
---
Working record file: `.claude/memory/workingState.md` (local, gitignored, injected at session start while it exists).

Argument: $ARGUMENTS

If the argument is `close`: read the record, move anything durable (a decision, a gap, a gotcha) to `docs/DECISIONS.md`, `GAPS.md` or the matching rule file, then delete the record file and print a 3-line summary. Stop.

Otherwise create or update the record so it always has exactly these sections, each current and short (whole file under 40 lines):

```
# Working state · <topic>   (updated <date time>)
## Goal
one line: what "fixed" means and how it will be verified
## Files changed so far
- path — one line on what changed
## Current error
exact message (first line only) + file:line
## Ruled out
- hypothesis — how it was disproved (command or file:line)
## Suspected cause
one hypothesis, marked as hypothesis
## Next step
one command or edit
```

Rules:
- Replace, do not append. Old errors, old snapshots and stale hypotheses leave the file when they stop being true; "Ruled out" is the only history kept.
- Run noisy commands through `/digest`; paste only the digest's failure lines here.
- After updating, print the record. If the loop has had more than five iterations without progress, say so and propose stepping back to `/plan`.
