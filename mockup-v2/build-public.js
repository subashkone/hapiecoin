// Concatenates public-src/*.html (markup, style) + public-src/*.js (each wrapped in <script>) into parts/10-public.html
const fs = require('fs'); const path = require('path');
const src = path.join(__dirname, 'public-src');
const files = fs.readdirSync(src).sort();
let out = '';
for (const f of files) { if (f.endsWith('.html')) out += fs.readFileSync(path.join(src, f), 'utf8') + '\n'; }
for (const f of files) { if (f.endsWith('.js')) out += '<script>\n/* ---- ' + f + ' ---- */\n' + fs.readFileSync(path.join(src, f), 'utf8') + '\n</script>\n'; }
fs.writeFileSync(path.join(__dirname, 'parts', '10-public.html'), out);
console.log('parts/10-public.html', out.length, 'bytes from', files.join(', '));
