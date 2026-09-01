const fs = require('fs');
const v = process.argv[2];
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.version = v;
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
console.log('  version: ' + p.version);
