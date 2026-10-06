'use strict';

// Shared helpers for the test scripts. Playwright isn't a project dependency (node_modules lives
// on OneDrive); point PLAYWRIGHT_MODULE at any installed copy, e.g.
//   set PLAYWRIGHT_MODULE=C:\tools\node_modules\playwright
const path = require('path');
const { pathToFileURL } = require('url');

function loadPlaywright() {
  return require(process.env.PLAYWRIGHT_MODULE || 'playwright');
}

function pageUrl(file) {
  return pathToFileURL(path.resolve(__dirname, '..', file)).href;
}

function createChecker(name) {
  let failures = 0;
  let passes = 0;
  const errors = [];
  return {
    errors,
    check(condition, message) {
      if (condition) passes++; else failures++;
      console.log(`${condition ? 'PASS' : 'FAIL'} [${name}] ${message}`);
    },
    finish() {
      if (errors.length) {
        failures++;
        console.log(`FAIL [${name}] page errors: ${errors.join(' | ')}`);
      }
      console.log(`${name}: ${passes} passed, ${failures} failed`);
      process.exitCode = failures ? 1 : 0;
    }
  };
}

module.exports = { loadPlaywright, pageUrl, createChecker };
