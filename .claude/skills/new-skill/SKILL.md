---
name: new-skill
description: Turn a prompt you keep repeating into a reusable project skill. Scaffolds .claude/skills/<name>/SKILL.md with correct frontmatter and a checklist body, then explains how to invoke and test it.
disable-model-invocation: true
arguments: [name, purpose]
allowed-tools: Read, Write, Glob
---
Create a project skill named `$name` whose purpose is: $purpose

0. Gate: a skill earns its place only if the process has repeated at least three times, is structured (same steps each time), and consistency matters. If it is vague, changes every time, or depends on one conversation, say so and recommend a plain prompt or a rule line instead, then stop.
1. Check `.claude/skills/` and `~/.claude/skills/` for an existing skill with the same job; if one exists, propose extending it instead and stop.
2. Write `.claude/skills/$name/SKILL.md` with:
   - frontmatter: `name`, a `description` that says both what it does and when to use it (Claude auto-invokes from this line), `argument-hint`, and the narrowest `allowed-tools` list that still works. Add `disable-model-invocation: true` if the skill has side effects (commits, deploys, deletes). Add `context: fork` only for long read-only research.
   - body: inputs (`$ARGUMENTS`), the numbered procedure with a verifiable check per step, the exact output shape, and what the skill must not do.
   - dynamic context lines (`!` followed by a backticked command) only for cheap, read-only commands such as `git status --short`.
3. Keep the body under 60 lines; put long reference material in a sibling file and link it.
4. Print the file, then a two-line test plan: the command to invoke it (`/$name ...`) and what a correct run looks like.
5. Add one line to the skills table in `docs/CLAUDE-SETUP.md`.
