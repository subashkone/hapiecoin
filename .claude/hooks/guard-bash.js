// PreToolUse (Bash|PowerShell): deny a short list of irreversible or dangerous commands.
// Everything else falls through to the normal permission system.
'use strict';
const { readInput, deny } = require('./_lib');

const input = readInput();
const cmd = String((input.tool_input && input.tool_input.command) || '');
if (!cmd) process.exit(0);

const rules = [
  [/\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+(?:--\s+)?(?:\/|~|\$HOME|\*|\.\.?|[A-Za-z]:[\\/]?)(?:\s|$)/, 'rm -r on a root, home, cwd or glob target'],
  [/\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+.*mockup-clone/, 'deleting the read-only reference copy mockup-clone/ (ADR-002)'],
  [/Remove-Item\b[^\n|;]*-Recurse[^\n|;]*(?:mockup-clone|[A-Za-z]:\\?(?:\s|["']|$))/i, 'recursive delete of a drive root or mockup-clone/'],
  [/\bgit\s+push\b[^\n|;]*(?:\s--force\b|\s-f\b|\s--force-with-lease\b)/, 'force push'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard discards work'],
  [/\bgit\s+clean\s+-[a-zA-Z]*[fdxX]/, 'git clean deletes untracked files'],
  [/\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.(?:\s|$)/, 'discarding all working-tree changes'],
  [/\bgit\s+branch\s+-D\b/, 'force-deleting a branch'],
  [/\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i, 'destructive SQL'],
  [/\bTRUNCATE\s+TABLE\b/i, 'destructive SQL'],
  [/delta\.exchange[^\n]*\/v2\/orders/i, 'calling a Delta Exchange order endpoint from the shell (real money)'],
];

for (const [re, why] of rules) {
  if (re.test(cmd)) {
    deny('PreToolUse', `Blocked by .claude/hooks/guard-bash.js: ${why}. If this is really intended, the user must run it by hand.`);
    process.exit(0);
  }
}
process.exit(0);
