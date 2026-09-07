// Shared helpers for HapieCoin Claude Code hooks (Node, cross-platform, no jq).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function projectDir(input) {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd());
}

function rel(root, p) {
  return path.relative(root, path.resolve(root, p)).split(path.sep).join('/');
}

function isUnder(root, p, sub) {
  const r = rel(root, p);
  return r === sub || r.startsWith(sub + '/');
}

function run(cmd, args, opts) {
  const o = Object.assign({ cwd: process.cwd(), timeout: 90000, encoding: 'utf8', shell: process.platform === 'win32' }, opts || {});
  const res = spawnSync(cmd, args, o);
  return {
    status: res.status,
    out: ((res.stdout || '') + (res.stderr || '')).trim(),
    error: res.error ? String(res.error.message || res.error) : null,
  };
}

function tail(text, n) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  return lines.slice(-n).join('\n');
}

function head(text, n) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  return lines.slice(0, n).join('\n');
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function deny(event, reason) {
  emit({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason } });
}

function context(event, text) {
  emit({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch (e) { return false; }
}

module.exports = { readInput, projectDir, rel, isUnder, run, tail, head, emit, deny, context, exists, fs, path };
