const fs = require('fs');
const p = 'src/tool-policy.js';
let s = fs.readFileSync(p, 'utf8');

const anchor = `  writefile: 'high',`;

const addition = `  'obsidian-create': 'high',
  writefile: 'high',`;

if (!s.includes(anchor)) throw new Error('policy anchor not found');
if (s.includes("'obsidian-create'")) throw new Error('obsidian-create policy already exists');
s = s.replace(anchor, addition);

fs.writeFileSync(p, s);
console.log('TOOL-POLICY PATCH OK');
