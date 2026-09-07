// Stop: when source files changed this session, actually run the test script (if any) and
// refuse to let Claude finish on a red suite. Also warns when mockup-v2 sources are newer
// than the generated HTML. Only real command output counts as "tests pass".
'use strict';
const { readInput, projectDir, run, tail, emit, exists, fs, path } = require('./_lib');

const input = readInput();
if (input.stop_hook_active) process.exit(0); // avoid loops
const root = projectDir(input);

let changed = [];
if (exists(path.join(root, '.git'))) {
  const st = run('git', ['status', '--porcelain'], { cwd: root, timeout: 15000 });
  if (!st.error && st.status === 0) changed = st.out.split(/\r?\n/).filter(Boolean).map(l => l.slice(3).trim().replace(/^"|"$/g, ''));
}
const codeChanged = changed.filter(f => /\.(ts|tsx|js|mjs|cjs|py)$/.test(f) && !f.startsWith('.claude/'));
const messages = [];

// 1. Tests, only when code changed and a test script exists at the root.
const pkgPath = path.join(root, 'package.json');
if (codeChanged.length && exists(pkgPath)) {
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) { pkg = {}; }
  if (pkg.scripts && pkg.scripts.test && !/no test specified/.test(pkg.scripts.test)) {
    const usePnpm = exists(path.join(root, 'pnpm-lock.yaml'));
    const res = usePnpm ? run('pnpm', ['test'], { cwd: root, timeout: 300000 }) : run('npm', ['test'], { cwd: root, timeout: 300000 });
    if (res.error) messages.push(`Stop hook: could not run tests (${res.error}).`);
    else if (res.status !== 0) {
      emit({ decision: 'block', reason: `Stop hook ran ${usePnpm ? 'pnpm' : 'npm'} test after your code changes and it FAILED (exit ${res.status}). Fix or explain before finishing:\n${tail(res.out, 30)}` });
      process.exit(0);
    } else messages.push(`Stop hook: ${usePnpm ? 'pnpm' : 'npm'} test passed.\n${tail(res.out, 5)}`);
  }
}

// 2. mockup-v2: sources newer than the generated bundle.
const gen = path.join(root, 'mockup-v2', 'coingreeks-v2.html');
if (exists(gen)) {
  const genTime = fs.statSync(gen).mtimeMs;
  const srcDirs = ['parts', 'parts-src', 'src-trd', 'chrome-src', 'public-src', 'adm-src', '_analytics-src'];
  const stale = changed.filter(f => srcDirs.some(d => f.startsWith(`mockup-v2/${d}/`)) && exists(path.join(root, f)) && fs.statSync(path.join(root, f)).mtimeMs > genTime);
  if (stale.length) messages.push(`Stop hook: ${stale.length} mockup-v2 source file(s) are newer than coingreeks-v2.html. Run "cd mockup-v2 && node assemble.js" then "node qa.js dark" before claiming the mock is updated.`);
}

if (messages.length) emit({ systemMessage: messages.join('\n') });
process.exit(0);
