#!/bin/sh
# Builds clone-v2/parts/21-analyse-trading.html from the split sources in this folder (v2 · HapieCoin "Obsidian Desk").
cd "$(dirname "$0")/.."
{ cat src-trd/a-markup.html; echo '<script>'; cat src-trd/b-core.js src-trd/c-dialogs.js src-trd/d-lists.js src-trd/e-journal.js src-trd/f-init.js; echo '</script>'; } > parts/21-analyse-trading.html
node -e "
const fs=require('fs');const src=fs.readFileSync('parts/21-analyse-trading.html','utf8');
const m=src.match(/<script>\n\/\* ===== area 21[\s\S]*?<\/script>\s*$/);
if(!m){console.log('no main script found');process.exit(1)}
const js=m[0].replace(/^<script>\n/,'').replace(/<\/script>\s*$/,'');
try{new Function(js);console.log('syntax OK, bytes',js.length)}catch(e){console.log('SYNTAX ERROR',e.message);process.exit(1)}
" && node assemble.js | head -2
