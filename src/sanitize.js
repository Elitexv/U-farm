// Allow-list HTML sanitizer for guide bodies written in the admin editor.
// Keeps simple formatting (headings, paragraphs, lists, links, tables,
// images) and drops every other tag and attribute. No dependencies.

const ALLOWED = {
  p: ['class'], br: [], hr: [],
  h2: [], h3: [], h4: [],
  strong: [], em: [], u: [], blockquote: [],
  ul: [], ol: [], li: [],
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height'],
  figure: [], figcaption: [],
  table: [], thead: [], tbody: [], tr: [], th: [], td: [],
  div: ['class'],
};
const RENAME = { b: 'strong', i: 'em', h1: 'h2', h5: 'h4', h6: 'h4' };
const VOID = new Set(['br', 'hr', 'img']);
const CLASSES = { p: ['note'], div: ['table-wrap'] };

const decode = (s) => s.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&colon;/gi, ':').replace(/&tab;|&newline;/gi, '');
const attrEsc = (s) => s.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function safeUrl(value, kind) {
  const v = decode(value).replace(/[\u0000- \u007f]+/g, '').toLowerCase();
  if (kind === 'src') return /^(https?:|\/|fsimg:)/.test(v);
  return /^(https?:|mailto:|tel:|\/|#)/.test(v);
}

function cleanAttrs(tag, raw) {
  const out = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    if (!ALLOWED[tag].includes(name)) continue;
    if (name === 'href' && !safeUrl(value, 'href')) continue;
    if (name === 'src' && !safeUrl(value, 'src')) continue;
    if (name === 'class') {
      const keep = value.split(/\s+/).filter((c) => (CLASSES[tag] || []).includes(c));
      if (!keep.length) continue;
      out.push(`class="${keep.join(' ')}"`);
      continue;
    }
    if ((name === 'width' || name === 'height') && !/^\d{1,4}$/.test(value)) continue;
    out.push(`${name}="${attrEsc(value)}"`);
  }
  if (tag === 'a' && out.some((a) => /^href="https?:/i.test(a))) out.push('rel="noopener"');
  if (tag === 'img') out.push('loading="lazy"');
  return out.length ? ' ' + out.join(' ') : '';
}

function sanitize(html) {
  const s = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|template|noscript|svg|math|form|textarea|select|title|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|template|noscript|svg|math|form|textarea|select|title|head)\b[^>]*>/gi, '');
  return s
    // Only "<tag" or "</tag" starts a tag; any other "<" is plain text.
    .split(/(<\/?[a-zA-Z][^>]*>?)/)
    .map((tok) => {
      if (!tok) return '';
      if (!/^<\/?[a-zA-Z]/.test(tok)) return tok.replace(/</g, '&lt;').replace(/>/g, '&gt;'); // text
      const m = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)\/?\s*>$/.exec(tok);
      if (!m) return '';
      let tag = m[2].toLowerCase();
      tag = RENAME[tag] || tag;
      if (!ALLOWED[tag]) return '';
      if (m[1]) return VOID.has(tag) ? '' : `</${tag}>`;
      return `<${tag}${cleanAttrs(tag, m[3])}>`;
    })
    .join('');
}

module.exports = { sanitize };
