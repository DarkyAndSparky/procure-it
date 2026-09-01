const v = process.argv[2] || '';
if (!/^\d{2}w\d{1,2}-(a|b|rc|r)\d{2}$/.test(v)) {
  console.error('ERROR: bad version format: ' + v);
  console.error('Expected: YYwWW-{a|b|rc|r}NN  (example: 26w35-r01)');
  process.exit(1);
}
console.log('OK: ' + v);
