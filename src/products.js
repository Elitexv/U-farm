// Local product catalog (src/data/products.json). Products are managed in
// Firestore through /admin/; this file is the starter catalog the admin can
// import, and the fallback the build uses if Firestore is empty or unreachable.
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
