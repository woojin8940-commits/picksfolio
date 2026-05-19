const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'SPAN', 'DIV', 'P', 'FONT']);
const ALLOWED_STYLE_PROPS = new Set([
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-color'
]);
const ALLOWED_FONT_ATTRS = new Set(['color', 'size']);

const LOOKS_HTML_RE = /<(?:br|span|div|p|b|strong|i|em|u|s|strike|font)[\s/>]/i;
const ESCAPED_TAG_RE = /&lt;\/?(?:br|span|div|p|b|strong|i|em|u|s|strike|font)\b/i;

export const looksLikeHtml = (value: string): boolean => LOOKS_HTML_RE.test(value || '');

const decodeBasicEntities = (value: string): string =>
  (value || '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

export const escapeHtml = (s: string): string =>
  (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const plainTextToHtml = (text: string): string =>
  escapeHtml(text || '').replace(/\r?\n/g, '<br>');

export const normalizeContentToHtml = (content: string): string => {
  if (!content) return '';
  if (looksLikeHtml(content)) return content;
  if (ESCAPED_TAG_RE.test(content)) {
    const decoded = decodeBasicEntities(content);
    if (looksLikeHtml(decoded)) return decoded;
  }
  return plainTextToHtml(content);
};

const filterStyle = (value: string): string =>
  (value || '')
    .split(';')
    .map(part => {
      const [rawKey, ...rest] = part.split(':');
      const key = (rawKey || '').trim().toLowerCase();
      const v = rest.join(':').trim();
      if (!key || !v) return '';
      if (!ALLOWED_STYLE_PROPS.has(key)) return '';
      if (/url\(|expression\(|javascript:/i.test(v)) return '';
      return `${key}: ${v}`;
    })
    .filter(Boolean)
    .join('; ');

const sanitizeElement = (node: Element): void => {
  const children = Array.from(node.children);
  for (const child of children) {
    const tag = child.tagName.toUpperCase();
    if (!ALLOWED_TAGS.has(tag)) {
      const text = child.ownerDocument!.createTextNode(child.textContent || '');
      child.replaceWith(text);
      continue;
    }
    const attrs = Array.from(child.attributes);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      if (name === 'style') {
        const filtered = filterStyle(attr.value);
        if (filtered) child.setAttribute('style', filtered);
        else child.removeAttribute('style');
      } else if (tag === 'FONT' && ALLOWED_FONT_ATTRS.has(name)) {
        // keep color/size on legacy <font>
      } else {
        child.removeAttribute(attr.name);
      }
    }
    sanitizeElement(child);
  }
};

export const sanitizeRichHtml = (html: string): string => {
  if (!html) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(`<div id="__rt_root">${html}</div>`, 'text/html');
  const root = doc.getElementById('__rt_root');
  if (!root) return '';
  sanitizeElement(root);
  return root.innerHTML;
};

export const renderPortfolioHtml = (content: string): string => {
  let html = sanitizeRichHtml(normalizeContentToHtml(content));
  for (let i = 0; i < 3; i++) {
    if (!ESCAPED_TAG_RE.test(html)) break;
    const decoded = decodeBasicEntities(html);
    if (!looksLikeHtml(decoded)) break;
    const next = sanitizeRichHtml(decoded);
    if (next === html) break;
    html = next;
  }
  return html;
};
