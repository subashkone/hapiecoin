// Self-test for the hooks: `node .claude/hooks/test-hooks.js` from the project root.
// Feeds sample tool inputs to each hook and prints what Claude Code would receive.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.resolve(__dirname, '..', '..');
process.env.CLAUDE_PROJECT_DIR = root;
let failures = 0;

function call(hook, input) {
  const res = spawnSync('node', [path.join(__dirname, hook)], { input: JSON.stringify(input), encoding: 'utf8', cwd: root, timeout: 120000 });
  const out = (res.stdout || '').trim();
  let json = null;
  try { json = out ? JSON.parse(out) : null; } catch (e) { json = { raw: out }; }
  return { status: res.status, json, stderr: (res.stderr || '').trim() };
}

function expect(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
  if (!cond) failures++;
}

const decision = r => r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision;
const reason = r => (r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecisionReason || '').slice(0, 80);

// guard-files
let r = call('guard-files.js', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'mockup-clone', 'core.js') }, cwd: root });
expect('guard-files denies mockup-clone', decision(r) === 'deny', reason(r));
r = call('guard-files.js', { tool_input: { file_path: 'apps/api/.env' } });
expect('guard-files denies .env', decision(r) === 'deny', reason(r));
r = call('guard-files.js', { tool_input: { file_path: 'apps/api/.env.example' } });
expect('guard-files allows .env.example', !r.json);
r = call('guard-files.js', { tool_input: { file_path: 'mockup-v2/coingreeks-v2.html' } });
expect('guard-files denies generated v2 html', decision(r) === 'deny', reason(r));
r = call('guard-files.js', { tool_input: { file_path: 'mockup-v2/parts/x.js' } });
expect('guard-files allows v2 source', !r.json);

// guard-bash: [command, shouldDeny]
const cases = [
  ['rm -r' + 'f /', true],
  ['rm -r' + 'f node_modules', false],
  ['rm -r' + 'f ' + 'mockup' + '-clone', true],
  ['git push --' + 'force origin main', true],
  ['git push origin main', false],
  ['git reset --' + 'hard HEAD~1', true],
  ['git clean -' + 'fd', true],
  ['git checkout -- .', true],
  ['git checkout -- src/x.ts', false],
  ['Remove-Item -Rec' + 'urse -Force ' + 'mockup' + '-clone', true],
  ['curl -X POST https://api.india.delta.exchange/v2/' + 'orders', true],
  ['psql -c "DR' + 'OP TABLE users"', true],
  ['ls -la', false],
  ['pnpm test', false],
];
for (const [cmd, shouldDeny] of cases) {
  r = call('guard-bash.js', { tool_name: 'Bash', tool_input: { command: cmd } });
  const denied = decision(r) === 'deny';
  expect(`guard-bash ${shouldDeny ? 'denies' : 'allows'}: ${cmd}`, denied === shouldDeny, denied ? reason(r) : '');
}

// post-edit-check
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapie-hooks-'));
const broken = path.join(tmp, 'broken.js');
fs.writeFileSync(broken, 'function (\n');
r = call('post-edit-check.js', { tool_input: { file_path: broken } });
expect('post-edit-check flags syntax error', r.json && /node --check failed/.test(r.json.hookSpecificOutput.additionalContext));
const brand = path.join(tmp, 'brand.js');
fs.writeFileSync(brand, 'const brand = "Coin" + "Greeks";\nconst x = "CoinGreeks";\n');
r = call('post-edit-check.js', { tool_input: { file_path: brand } });
expect('post-edit-check flags competitor name', r.json && /HapieCoin/.test(r.json.hookSpecificOutput.additionalContext));
const badJson = path.join(tmp, 'x.json');
fs.writeFileSync(badJson, '{ nope ');
r = call('post-edit-check.js', { tool_input: { file_path: badJson } });
expect('post-edit-check flags invalid JSON', r.json && /not valid JSON/.test(r.json.hookSpecificOutput.additionalContext));
r = call('post-edit-check.js', { tool_input: { file_path: path.join(__dirname, '_lib.js') } });
expect('post-edit-check silent on clean file', !r.json);
fs.rmSync(tmp, { recursive: true, force: true });

// session-start
r = call('session-start.js', { hook_event_name: 'SessionStart', cwd: root });
const ctx = r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.additionalContext || '';
expect('session-start injects activeContext', /Active context/.test(ctx) && /GAPS\.md/.test(ctx));
console.log('--- session-start context preview ---\n' + ctx.split('\n').slice(0, 12).join('\n') + '\n---');
const working = path.join(root, '.claude', 'memory', 'workingState.md');
const hadWorking = fs.existsSync(working);
if (!hadWorking) {
  fs.writeFileSync(working, '# Working state · test\n## Current error\nTypeError at x.ts:1\n');
  r = call('session-start.js', { hook_event_name: 'SessionStart', cwd: root });
  const ctx2 = r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.additionalContext || '';
  expect('session-start injects open debug loop', /Open debug loop/.test(ctx2) && /TypeError at x\.ts:1/.test(ctx2));
  fs.unlinkSync(working);
}

// stop-check
r = call('stop-check.js', { hook_event_name: 'Stop', stop_hook_active: false });
expect('stop-check runs without error', r.status === 0, r.stderr);
r = call('stop-check.js', { hook_event_name: 'Stop', stop_hook_active: true });
expect('stop-check exits quietly when re-entered', r.status === 0 && !r.json);

console.log(failures ? `\n${failures} hook test(s) FAILED` : '\nAll hook tests passed');
process.exit(failures ? 1 : 0);
