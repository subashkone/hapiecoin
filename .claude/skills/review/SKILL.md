---
name: review
description: Run the code-reviewer and fact-checker subagents on the current changes (or a named path) and merge their reports. Use after implementing a feature and before /commit.
argument-hint: [optional path or "staged"]
allowed-tools: Agent, Bash(git status *), Bash(git diff *), Read, Grep, Glob
---
Target: $ARGUMENTS (default: the uncommitted working tree; "staged" means `git diff --cached`).

1. Capture the diff or file list for the target. If nothing changed, say so and stop.
2. Pick the depth by risk and say which you chose:
   - **light** for a utility, a copy change, a small UI tweak, a test update: code-reviewer only, requirement match + correctness.
   - **deep** (default when unsure) for anything touching auth, payments, permissions, orders, pricing math, migrations, WS handling, or more than three files: code-reviewer with all layers plus fact-checker.
3. Launch the `code-reviewer` subagent with the diff, the original request, and the agreed plan if there was one. For deep reviews also launch the `fact-checker` subagent with the claims made about the change. Run them in the background in one turn, then wait.
4. Merge into one report:
   - **Blockers** (from either agent: WRONG facts, blocker findings)
   - **Majors**
   - **Minors**
   - **Verified** claims (one line each)
   - **Not covered** by this review
5. Verdict: "ready for /commit" or "fix first", with the shortest fix list.
6. Record any newly discovered gap as a row in `GAPS.md` (ask first if it is a product decision rather than a defect).

Do not fix anything inside this skill unless the user asks; report only.
