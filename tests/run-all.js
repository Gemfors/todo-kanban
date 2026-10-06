'use strict';
// Runs every test file in this folder and exits non-zero if any fail.
//   node tests/run-all.js          (needs Playwright: set PLAYWRIGHT_MODULE if it isn't installed here)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
const summary = [];
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8', env: process.env });
  const output = (result.stdout || '') + (result.stderr || '');
  const failures = output.split('\n').filter(line => line.startsWith('FAIL') || /Error/.test(line) && !line.startsWith('PASS'));
  if (process.argv.includes('--verbose')) process.stdout.write(output);
  const last = output.trim().split('\n').pop();
  summary.push(`${result.status === 0 ? 'ok  ' : 'FAIL'} ${file.padEnd(22)} ${last}`);
  if (result.status !== 0) {
    failed = true;
    failures.forEach(line => summary.push(`       ${line}`));
  }
}

console.log(summary.join('\n'));
process.exitCode = failed ? 1 : 0;
