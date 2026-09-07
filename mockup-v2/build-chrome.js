// Concatenates chrome-src/00-style.html + chrome-src/*.js (sorted) into parts/00-chrome.html
const fs = require('fs'); const path = require('path');
const src = path.join(__dirname, 'chrome-src');
const files = fs.readdirSync(src).sort();
let out = '';
for (const f of files) { if (f.endsWith('.html')) out += fs.readFileSync(path.join(src, f), 'utf8') + '\n'; }
out += '<script>\n(function () {\n';
for (const f of files) { if (f.endsWith('.js')) out += '// ---- ' + f + ' ----\n' + fs.readFileSync(path.join(src, f), 'utf8') + '\n'; }
out += '})();\n</script>\n';
fs.writeFileSync(path.join(__dirname, 'parts', '00-chrome.html'), out);
console.log('parts/00-chrome.html', out.length, 'bytes from', files.join(', '));
