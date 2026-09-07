---
name: plan
description: Explore first, then produce a written implementation plan for a task before any file is edited. Use for any change touching more than one file, any new screen or endpoint, or when the request is ambiguous.
argument-hint: [task description]
allowed-tools: Read, Grep, Glob, Bash(git status *), Bash(git diff *), Bash(git log *), Bash(graphify *)
---
Plan the task: $ARGUMENTS

Do not edit or create any project file during this skill. Output is a plan only.

If the task is trivial (the diff fits in one sentence: a typo, a label, a constant), say so in one line, name the file, and stop; no plan needed.

## Step 0: restate
- Restate the request in concrete terms: what changes for the user, what must not change, and what "done" looks like. If two readings lead to materially different work, ask now.
- For a refactor also state the scope boundary: which public interfaces and behaviours are preserved, which tests prove nothing changed, and what is explicitly out of scope.

## Step 1: understand
- Read `.claude/memory/activeContext.md` and the ADRs in `docs/DECISIONS.md` that touch this area.
- Find the traceability IDs in `spec/traceability.json` that this task covers (Grep by feature words). If none match, say the task is untraced and propose a new ID.
- Locate every file the change touches (Glob/Grep, or `/graphify` for structure). Read the parts you will change; confirm every symbol you plan to call exists.
- Check `GAPS.md` for related open gaps.

## Step 2: decide
- List unknowns and the assumption you will make for each. Ask the user only where different answers lead to materially different work.
- Choose the approach; name one rejected alternative and why.

## Step 3: write the plan
Print this exact structure:
1. **Goal** (one sentence) and traceability IDs.
2. **Files** to change or create, each with one line on what changes.
3. **Steps** in order, each verifiable (what command or check proves it).
4. **Tests** to add or update (Vitest/Playwright titles with IDs) and what QA command you will run.
5. **Risks and rules touched** (trading safety, money math, product identity, mockup-clone read-only).
6. **Decisions to record** as a new ADR, if any.

End with: "Reply 'go' to implement, or edit the plan." Then stop.
