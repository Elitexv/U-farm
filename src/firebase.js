// Firebase project config (public by design — access is controlled by
// firestore.rules) and a tiny Firestore REST client for the build, so the
// site still has zero npm dependencies.
const config = {
  apiKey: 'AIzaSyBxYfdG1y1zDNvzWYals4TC0XNlYiwKTnE',
  authDomain: 'u-farm-d7175.firebaseapp.com',
  projectId: 'u-farm-d7175',
  storageBucket: 'u-farm-d7175.firebasestorage.app',
  messagingSenderId: '295923248254',
  appId: '1:295923248254:web:0be77d0096cc7ae87efc2f',
  measurementId: 'G-YH5LBQ9D2R',
};

const BASE = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;

// Firestore REST "typed values" → plain JS.
function decode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decode(v);
  return out;
}

async function request(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// All documents in a collection, as [{ id, ...fields }].
async function getCollection(name) {
  const docs = [];
  let token = '';
  do {
    const data = await request(`${BASE}/${name}?pageSize=300&key=${config.apiKey}${token ? `&pageToken=${token}` : ''}`);
    if (!data) break;
    for (const d of data.documents || []) docs.push({ id: d.name.split('/').pop(), ...decodeFields(d.fields || {}) });
    token = data.nextPageToken || '';
  } while (token);
  return docs;
}

// One document's fields, or null if it does not exist.
async function getDoc(path) {
  const data = await request(`${BASE}/${path}?key=${config.apiKey}`);
  return data ? decodeFields(data.fields || {}) : null;
}

module.exports = { config, getCollection, getDoc };
