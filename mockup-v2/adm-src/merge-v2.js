// Concatenates the v2 admin source chunks into parts/40-admin.html
const fs = require('fs'); const path = require('path');
const dir = __dirname; const files = fs.readdirSync(dir).filter((f) => /^v2-\d\d-.*\.html$/.test(f)).sort();
const out = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\s+$/, '')).join('\n\n') + '\n';
fs.writeFileSync(path.join(dir, '..', 'parts', '40-admin.html'), out);
console.log('merged', files.join(', '), '->', out.length, 'bytes');
