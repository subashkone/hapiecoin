// Concatenates the analytics source fragments into ../parts/50-analytics.html and runs the v2 assembler.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const src = __dirname; const root = path.join(src, '..');
const files = ['01-sections.html', '02-style.html', '03-core.js', '04-screens-a.js', '05-screens-b.js', '06-screens-c.js'];
const out = files.map((f) => fs.readFileSync(path.join(src, f), 'utf8').trim()).join('\n');
fs.writeFileSync(path.join(root, 'parts', '50-analytics.html'), out + '\n');
console.log('wrote parts/50-analytics.html', out.length, 'bytes');
console.log(cp.execSync('node assemble.js', { cwd: root }).toString());
