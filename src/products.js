// Product catalog store. Products live in src/data/products.json, which is
// edited through the admin panel (npm start → /admin) or by hand.
// Each product gets its own page at /products/<slug>/.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'products.json');

// Read fresh from disk every time so the admin server sees its own saves.
function load() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

// Atomic write: never leaves a half-written catalog behind.
function save(products) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(products, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
}

module.exports = { load, save, FILE };
