const fs = require('fs');
const p = 'src/agent-loop.js';
let s = fs.readFileSync(p, 'utf8');

// 1. Add to TOOL_ARG_SCHEMAS after writefile entry
const schemaAnchor = `  writefile: {
    required: ['path', 'content'],
    types: {
      path: 'string',
      content: 'string',
    },
  },`;

const schemaAddition = schemaAnchor + `

  'obsidian-create': {
    required: ['path', 'content'],
    types: {
      path: 'string',
      content: 'string',
    },
  },`;

if (!s.includes(schemaAnchor)) throw new Error('schema anchor not found');
if (s.includes("'obsidian-create'")) throw new Error('obsidian-create schema already exists');
s = s.replace(schemaAnchor, schemaAddition);

// 2. Add to buildSkillInput before 'addskill' case
const buildAnchor = `    case 'addskill':`;

const buildAddition = `    case 'obsidian-create':
      return \`obsidian-create: \${JSON.stringify({
        path: args.path || '',
        content: args.content || '',
      })}\`;

    case 'addskill':`;

if (!s.includes(buildAnchor)) throw new Error('buildSkillInput anchor not found');
s = s.replace(buildAnchor, buildAddition);

fs.writeFileSync(p, s);
console.log('AGENT-LOOP PATCH OK');
