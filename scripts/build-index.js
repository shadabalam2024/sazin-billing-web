// Assembles index.html from index.template.html + partials/*.html.
//
// index.html was one 886-line file with every tab's markup inline, making it
// hard to find or safely edit one tab without rereading the whole thing. A
// runtime fetch()-based split was considered but rejected: several js/*.js
// files (auth.js, billing.js, quotations.js, autocomplete.js) run on
// DOMContentLoaded and read elements that live inside these tabs (e.g.
// auth.js populates #hdrName and restores the active tab by id) —
// DOMContentLoaded fires before an async fetch() could finish, which would
// silently break that initialization order. Build-time concatenation avoids
// that entirely: the served index.html is byte-for-byte the same kind of
// file as before, just generated from smaller source files instead of
// hand-edited as one.
//
// Run via `npm run build:html` after editing any file in partials/.
// CI (.github/workflows/ci.yml) re-runs this and fails if index.html is
// out of date with its sources, so a forgotten rebuild can't ship.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'index.template.html'), 'utf8');

const output = template.replace(/<!--INCLUDE:([a-zA-Z0-9_-]+)-->/g, (match, name) => {
  const partialPath = path.join(root, 'partials', `${name}.html`);
  if (!fs.existsSync(partialPath)) {
    throw new Error(`build-index: no partials/${name}.html for marker ${match}`);
  }
  return fs.readFileSync(partialPath, 'utf8').replace(/\n$/, '');
});

fs.writeFileSync(path.join(root, 'index.html'), output);
console.log('Built index.html from index.template.html + partials/*.html');
