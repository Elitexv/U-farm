// Placeholder product illustrations (SVG), drawn in the brand colours.
// Replace with real product photos when available (see `image` in products.js).
const O = '#ff7a1a'; // orange
const OD = '#c95400'; // dark orange
const B = '#1c1c1c'; // body black
const G = '#2c2c2c'; // grey
const S = '#c9c9c9'; // steel
const SCR = '#0f2a12'; // screen
const TXT = '#7dff8a'; // screen text

// Clean studio backdrop: soft green halo and a floor shadow.
const bg = `<defs><radialGradient id="halo" cx="50%" cy="48%" r="55%"><stop offset="0" stop-color="#e3f3e7"/><stop offset="1" stop-color="#ffffff"/></radialGradient></defs>
<rect width="400" height="300" fill="#ffffff"/>
<circle cx="200" cy="148" r="128" fill="url(#halo)"/>
<ellipse cx="200" cy="270" rx="110" ry="8" fill="#0f1a14" opacity=".1"/>`;

const screen = (x, y, w, h, t) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${SCR}"/><text x="${x + w / 2}" y="${y + h / 2 + 7}" font-family="monospace" font-size="20" font-weight="700" fill="${TXT}" text-anchor="middle">${t}</text>`;

const buttons = (x, y) =>
  `<circle cx="${x}" cy="${y}" r="8" fill="${O}"/><circle cx="${x + 26}" cy="${y}" r="8" fill="${G}"/><circle cx="${x + 52}" cy="${y}" r="8" fill="${G}"/>`;

const shapes = {
  'meter-cup': `
    <rect x="160" y="40" width="80" height="18" rx="4" fill="${S}"/>
    <rect x="166" y="56" width="68" height="40" fill="#9a9a9a"/>
    <rect x="140" y="92" width="120" height="175" rx="18" fill="${B}" stroke="${O}" stroke-width="3"/>
    <rect x="140" y="230" width="120" height="37" rx="0" fill="${O}"/>
    <rect x="140" y="250" width="120" height="17" rx="10" fill="${O}"/>
    ${screen(155, 110, 90, 46, '14.5%')}
    ${buttons(174, 185)}
    <text x="200" y="254" font-family="Arial" font-size="13" font-weight="700" fill="#111" text-anchor="middle">U-FARM</text>`,
  'meter-probe': `
    <line x1="210" y1="160" x2="360" y2="38" stroke="${S}" stroke-width="8" stroke-linecap="round"/>
    <circle cx="360" cy="38" r="5" fill="${S}"/>
    <rect x="70" y="120" width="150" height="110" rx="18" fill="${B}" stroke="${O}" stroke-width="3" transform="rotate(-20 145 175)"/>
    <g transform="rotate(-20 145 175)">
      ${screen(88, 135, 92, 42, '17.8%')}
      ${buttons(100, 205)}
      <rect x="70" y="218" width="150" height="12" fill="${O}"/>
    </g>`,
  'meter-pins': `
    <line x1="185" y1="30" x2="185" y2="70" stroke="${S}" stroke-width="6" stroke-linecap="round"/>
    <line x1="215" y1="30" x2="215" y2="70" stroke="${S}" stroke-width="6" stroke-linecap="round"/>
    <rect x="170" y="62" width="60" height="22" rx="4" fill="${G}"/>
    <rect x="150" y="80" width="100" height="185" rx="20" fill="${B}" stroke="${O}" stroke-width="3"/>
    ${screen(163, 100, 74, 44, '12%')}
    <circle cx="182" cy="172" r="9" fill="${O}"/><circle cx="218" cy="172" r="9" fill="${G}"/>
    <rect x="150" y="225" width="100" height="40" fill="${O}"/>
    <rect x="150" y="245" width="100" height="20" rx="12" fill="${O}"/>
    <text x="200" y="250" font-family="Arial" font-size="12" font-weight="700" fill="#111" text-anchor="middle">U-FARM</text>`,
  'meter-pad': `
    <rect x="110" y="70" width="180" height="190" rx="26" fill="${B}" stroke="${O}" stroke-width="3"/>
    ${screen(135, 92, 130, 54, '8.6%')}
    ${buttons(160, 175)}
    <rect x="130" y="205" width="140" height="40" rx="10" fill="${O}"/>
    <g stroke="#111" stroke-width="3" fill="none" opacity=".6"><path d="M150 225h100"/><path d="M160 215h80"/><path d="M160 235h80"/></g>`,
  'meter-dial': `
    <line x1="185" y1="160" x2="185" y2="275" stroke="${S}" stroke-width="5"/>
    <line x1="215" y1="160" x2="215" y2="275" stroke="${S}" stroke-width="5"/>
    <circle cx="200" cy="100" r="75" fill="${B}" stroke="${O}" stroke-width="4"/>
    <circle cx="200" cy="100" r="60" fill="#f2efe6"/>
    <path d="M150 100a50 50 0 0 1 100 0" fill="none" stroke="${O}" stroke-width="10"/>
    <path d="M150 100a50 50 0 0 1 30-46" fill="none" stroke="#d33" stroke-width="10"/>
    <line x1="200" y1="100" x2="232" y2="62" stroke="#111" stroke-width="4" stroke-linecap="round"/>
    <circle cx="200" cy="100" r="6" fill="#111"/>
    <rect x="175" y="165" width="50" height="16" rx="4" fill="${G}"/>`,
  sprayer: `
    <rect x="130" y="55" width="120" height="200" rx="34" fill="${O}"/>
    <rect x="150" y="40" width="80" height="26" rx="8" fill="${B}"/>
    <rect x="145" y="110" width="90" height="10" rx="5" fill="${OD}"/>
    <rect x="145" y="170" width="90" height="10" rx="5" fill="${OD}"/>
    <path d="M250 220c60 10 70-40 80-90" fill="none" stroke="${B}" stroke-width="8"/>
    <line x1="330" y1="130" x2="360" y2="40" stroke="${S}" stroke-width="6" stroke-linecap="round"/>
    <path d="M352 36l18-6-4 18z" fill="${S}"/>
    <text x="190" y="150" font-family="Arial" font-size="16" font-weight="800" fill="#111" text-anchor="middle">U-FARM</text>`,
  pump: `
    <rect x="70" y="80" width="260" height="180" rx="10" fill="none" stroke="${S}" stroke-width="8"/>
    <rect x="100" y="110" width="120" height="100" rx="10" fill="${B}" stroke="${O}" stroke-width="3"/>
    <rect x="115" y="95" width="90" height="30" rx="8" fill="${O}"/>
    <circle cx="270" cy="185" r="45" fill="${O}"/>
    <circle cx="270" cy="185" r="18" fill="${B}"/>
    <rect x="255" y="110" width="30" height="40" fill="${OD}"/>
    <rect x="310" y="175" width="45" height="22" fill="${OD}"/>
    <text x="160" y="170" font-family="Arial" font-size="15" font-weight="800" fill="${O}" text-anchor="middle">7HP</text>`,
  machine: `
    <path d="M150 40h120l-20 70h-80z" fill="${OD}"/>
    <rect x="100" y="105" width="210" height="110" rx="12" fill="${O}"/>
    <rect x="120" y="125" width="80" height="60" rx="8" fill="${B}"/>
    <rect x="310" y="150" width="50" height="26" fill="${B}"/>
    <circle cx="140" cy="240" r="24" fill="${B}" stroke="${S}" stroke-width="5"/>
    <circle cx="270" cy="240" r="24" fill="${B}" stroke="${S}" stroke-width="5"/>
    <text x="160" y="162" font-family="Arial" font-size="14" font-weight="800" fill="${O}" text-anchor="middle">U-FARM</text>`,
  planter: `
    <line x1="230" y1="160" x2="350" y2="40" stroke="${S}" stroke-width="8" stroke-linecap="round"/>
    <line x1="330" y1="40" x2="370" y2="40" stroke="${B}" stroke-width="12" stroke-linecap="round"/>
    <path d="M120 90h130l-25 90h-80z" fill="${O}"/>
    <rect x="115" y="80" width="140" height="18" rx="4" fill="${OD}"/>
    <circle cx="185" cy="225" r="42" fill="${B}" stroke="${S}" stroke-width="6"/>
    <circle cx="185" cy="225" r="8" fill="${S}"/>`,
  hoe: `
    <line x1="90" y1="270" x2="300" y2="60" stroke="#a0672e" stroke-width="12" stroke-linecap="round"/>
    <path d="M285 55l50 10 10 80-70-20z" fill="${S}"/>
    <rect x="280" y="48" width="24" height="24" rx="4" fill="${O}"/>`,
  spade: `
    <rect x="190" y="20" width="20" height="160" rx="6" fill="${O}"/>
    <rect x="165" y="15" width="70" height="16" rx="8" fill="${B}"/>
    <path d="M150 175h100v45c0 30-25 50-50 55-25-5-50-25-50-55z" fill="${S}"/>
    <rect x="150" y="170" width="100" height="12" rx="4" fill="#9a9a9a"/>`,
  fork: `
    <rect x="190" y="20" width="20" height="150" rx="6" fill="${O}"/>
    <path d="M165 30a35 22 0 0 1 70 0" fill="none" stroke="${B}" stroke-width="12"/>
    <rect x="150" y="165" width="100" height="16" rx="6" fill="${S}"/>
    <g fill="${S}"><rect x="152" y="178" width="12" height="90" rx="5"/><rect x="180" y="178" width="12" height="90" rx="5"/><rect x="208" y="178" width="12" height="90" rx="5"/><rect x="236" y="178" width="12" height="90" rx="5"/></g>`,
  shears: `
    <path d="M200 150l-90 110" stroke="${O}" stroke-width="26" stroke-linecap="round"/>
    <path d="M200 150l90 110" stroke="${B}" stroke-width="26" stroke-linecap="round"/>
    <path d="M200 150l-40-110c30 10 50 50 52 100z" fill="${S}"/>
    <path d="M200 150l40-110c-20 20-35 60-28 105z" fill="#9a9a9a"/>
    <circle cx="200" cy="150" r="12" fill="${O}"/>`,
  machete: `
    <path d="M110 220l210-170c20 10 30 30 20 50l-200 150z" fill="${S}"/>
    <rect x="60" y="200" width="80" height="34" rx="10" fill="${O}" transform="rotate(-38 100 217)"/>
    <circle cx="90" cy="230" r="4" fill="#111"/><circle cx="112" cy="213" r="4" fill="#111"/>`,
  sickle: `
    <path d="M220 200c-90-10-120-120-30-170 -40 50-20 140 50 150z" fill="${S}"/>
    <rect x="215" y="190" width="95" height="28" rx="10" fill="${O}" transform="rotate(30 230 200)"/>`,
  wheelbarrow: `
    <path d="M90 110h220l-40 90h-150z" fill="${O}"/>
    <path d="M90 110h220" stroke="${OD}" stroke-width="10"/>
    <line x1="270" y1="200" x2="360" y2="230" stroke="${B}" stroke-width="8" stroke-linecap="round"/>
    <line x1="130" y1="200" x2="80" y2="235" stroke="${B}" stroke-width="8"/>
    <circle cx="80" cy="235" r="30" fill="${B}" stroke="${S}" stroke-width="5"/>
    <line x1="250" y1="200" x2="250" y2="260" stroke="${B}" stroke-width="8"/>`,
};

function art(key) {
  const shape = shapes[key];
  if (!shape) throw new Error(`Unknown art key: ${key}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="800" height="600">${bg}${shape}</svg>`;
}

module.exports = { art, keys: Object.keys(shapes) };
