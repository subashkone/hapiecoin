// PostToolUse (Edit|Write|MultiEdit): light, fast checks on the file just written.
// Output goes back to Claude as additionalContext only when something is wrong,
// so an invented import or a syntax error is visible immediately (article: "make hallucinating expensive").
'use strict';
const { readInput, projectDir, rel, run, head, context, exists, fs, path } = require('./_lib');

const input = readInput();
const file = input.tool_input && input.tool_input.file_path;
if (!file) process.exit(0);
const root = projectDir(input);
const abs = path.resolve(root, file);
if (!exists(abs)) process.exit(0);
const r = rel(root, abs);
const ext = path.extname(abs).toLowerCase();
const problems = [];

function findUp(startDir, names) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    for (const n of names) if (exists(path.join(dir, n))) return path.join(dir, n);
    if (rel(root, dir) === '' || rel(root, dir).startsWith('..')) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') {
  const tsconfig = findUp(path.dirname(abs), ['tsconfig.json']);
  if (tsconfig) {
    const res = run('npx', ['--no-install', 'tsc', '--noEmit', '--pretty', 'false', '-p', path.dirname(tsconfig)], { cwd: path.dirname(tsconfig), timeout: 120000 });
    if (res.error) problems.push(`tsc could not run (${res.error}); run pnpm typecheck manually.`);
    else if (res.status !== 0) {
      const lines = res.out.split(/\r?\n/).filter(Boolean);
      const mine = lines.filter(l => l.replace(/\\/g, '/').includes(r.split('/').pop()));
      const shown = (mine.length ? mine : lines).slice(0, 20).join('\n');
      problems.push(`tsc --noEmit reported ${lines.length} line(s)${mine.length ? `, ${mine.length} in ${r}` : ''}:\n${shown}`);
    }
  }
  const eslintCfg = findUp(path.dirname(abs), ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts', '.eslintrc.json', '.eslintrc.cjs', '.eslintrc.js']);
  if (eslintCfg) {
    const res = run('npx', ['--no-install', 'eslint', abs], { cwd: path.dirname(eslintCfg), timeout: 60000 });
    if (!res.error && res.status !== 0 && res.out) problems.push(`eslint:\n${head(res.out, 20)}`);
  }
} else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
  const res = run('node', ['--check', abs], { timeout: 20000 });
  if (res.status !== 0) problems.push(`node --check failed for ${r}:\n${head(res.out, 15)}`);
} else if (ext === '.json') {
  try { JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { problems.push(`${r} is not valid JSON: ${e.message}`); }
} else if (ext === '.py') {
  const res = run('python', ['-m', 'py_compile', abs], { timeout: 20000 });
  if (res.status !== 0) problems.push(`py_compile failed for ${r}:\n${head(res.out, 15)}`);
}

// Product identity check on HapieCoin sources (mockup-clone is excluded by guard-files, spec/docs may cite the original).
if (!r.startsWith('mockup-clone/') && !r.startsWith('docs/') && !r.startsWith('spec/') && !r.startsWith('.claude/') && r !== 'GAPS.md' && r !== 'CLAUDE.md') {
  try {
    const txt = fs.readFileSync(abs, 'utf8');
    const m = txt.match(/CoinGreeks|coingreeks/g);
    if (m && ['.ts', '.tsx', '.js', '.mjs', '.html', '.md', '.json', '.css'].includes(ext) && !/^mockup-v2\/(README|V2-BRIEF)/.test(r)) {
      problems.push(`${r} mentions "CoinGreeks" ${m.length} time(s). The product is HapieCoin (ADR-001); use CoinGreeks only when referring to the original site.`);
    }
  } catch (e) { /* ignore */ }
}

if (problems.length) {
  context('PostToolUse', `Post-edit check for ${r}:\n${problems.join('\n\n')}\nFix these before continuing, or state explicitly why they are expected.`);
}
process.exit(0);
