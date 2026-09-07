// SessionStart (startup, resume, clear, compact): inject the volatile project state so a
// fresh context knows where we are without re-reading the repo.
'use strict';
const { readInput, projectDir, run, context, exists, fs, path } = require('./_lib');

const input = readInput();
const root = projectDir(input);
const parts = [];

const active = path.join(root, '.claude', 'memory', 'activeContext.md');
if (exists(active)) parts.push(fs.readFileSync(active, 'utf8').trim());

const working = path.join(root, '.claude', 'memory', 'workingState.md');
if (exists(working)) {
  const w = fs.readFileSync(working, 'utf8').trim();
  if (w) parts.push('Open debug loop (.claude/memory/workingState.md, verify before trusting):\n' + w);
}

const decisions = path.join(root, 'docs', 'DECISIONS.md');
if (exists(decisions)) {
  const heads = fs.readFileSync(decisions, 'utf8').split(/\r?\n/).filter(l => /^## ADR-/.test(l));
  if (heads.length) parts.push(`Latest decisions (docs/DECISIONS.md, ${heads.length} total):\n` + heads.slice(-3).map(h => '- ' + h.replace(/^## /, '')).join('\n'));
}

const gaps = path.join(root, 'GAPS.md');
if (exists(gaps)) {
  const rows = fs.readFileSync(gaps, 'utf8').split(/\r?\n/).filter(l => /^\|\s*\d+\s*\|/.test(l));
  const open = rows.filter(l => /\|\s*open\s*\|\s*$/i.test(l)).length;
  parts.push(`GAPS.md: ${open} open of ${rows.length} rows.`);
}

if (exists(path.join(root, '.git'))) {
  let br = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeout: 10000 });
  if (br.status !== 0) br = run('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root, timeout: 10000 }); // repo with no commits yet
  const st = run('git', ['status', '--porcelain'], { cwd: root, timeout: 15000 });
  const n = st.status === 0 && st.out ? st.out.split(/\r?\n/).filter(Boolean).length : 0;
  const hasCommit = run('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, timeout: 10000 }).status === 0;
  parts.push(`Git: branch ${br.status === 0 ? br.out : '?'}${hasCommit ? '' : ' (no commits yet)'}, ${n} uncommitted path(s).`);
} else {
  parts.push('Git: this folder is not a git repository yet.');
}

parts.push('Skills: /plan (before multi-file work), /digest (noisy commands), /debug-loop (working record), /review (code-reviewer + fact-checker), /commit, /checkpoint (save state before /compact), /frontend-design, /new-skill, /graphify.');

context('SessionStart', parts.join('\n\n'));
process.exit(0);
