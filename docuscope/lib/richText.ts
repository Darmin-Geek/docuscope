// Shared rich-text helpers (issue #81). The paragraph fields in the File
// Details and Information sidebars store sanitised HTML in their existing text
// columns; these helpers are the single allow-list used everywhere that HTML is
// written, rendered, or measured. Pure string functions with no DOM or React
// dependency so the exact same sanitiser runs on the client (editor output +
// render) and on the server (defence-in-depth on write). See docs / issue #81.

// The only tags a stored value may contain. Everything else is stripped (its
// tag removed, its text kept) — except <script>/<style>, whose contents are
// dropped entirely. Constrained on purpose: this small set is the security
// story (no arbitrary markup can reach another contributor's browser) and the
// search story (tags are stripped from the tsvector, Section 4 of the plan).
const ALLOWED_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "br",
  "p",
  "ul",
  "ol",
  "li",
  "a",
]);

// Matches one HTML tag, tolerating quoted attribute values that themselves
// contain ">" (so `<a href="a>b">` is consumed as a single tag).
const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Pull a safe href out of an <a> tag's raw attribute string, or null. Only
// http(s), mailto, and relative (#/, path, no-scheme) URLs are allowed; anything
// with another scheme — notably javascript: — is rejected so a link can never
// carry executable script.
function safeHref(attrs: string): string | null {
  const match = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!match) return null;
  // Strip every ASCII control / whitespace char (incl. tab, LF, CR). The URL
  // parser drops these before resolving the scheme, so leaving them in would let
  // "java\tscript:" slip past the scheme check below and re-form as
  // "javascript:" in the browser. Removing them makes the scheme test operate on
  // the same string the browser will.
  const raw = (match[2] ?? match[3] ?? match[4] ?? "").replace(
    /[\u0000-\u0020]/g,
    "",
  );
  if (!raw) return null;
  // A scheme is everything before the first ":" that precedes any /, ?, or #.
  const schemeMatch = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https" && scheme !== "mailto") {
      return null;
    }
  }
  return escapeHtml(raw);
}

// Reduce arbitrary HTML to the allow-list above. Unknown tags are unwrapped
// (text kept), <script>/<style> blocks are removed wholesale, all attributes are
// dropped except a validated href on <a>, and any stray "<" that isn't a real
// tag is escaped. Idempotent: sanitising already-clean HTML returns it unchanged.
export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return "";
  // Remove script/style elements including their content, closed or not.
  let s = input.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<(script|style)\b[\s\S]*$/gi, "");

  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] !== "<") {
      out += s[i];
      i += 1;
      continue;
    }
    const match = TAG_RE.exec(s.slice(i));
    if (!match) {
      // A "<" that doesn't start a valid tag is literal text.
      out += "&lt;";
      i += 1;
      continue;
    }
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    if (ALLOWED_TAGS.has(name)) {
      if (name === "br") {
        out += "<br>";
      } else if (name === "a" && !closing) {
        const href = safeHref(match[3]);
        out += href
          ? `<a href="${href}" target="_blank" rel="noopener noreferrer">`
          : "<a>";
      } else {
        out += closing ? `</${name}>` : `<${name}>`;
      }
    }
    // Disallowed tag: drop the tag itself, keep any text it wraps.
    i += match[0].length;
  }
  return out;
}

// True when a (sanitised or legacy) value carries no visible text — used to keep
// the "blank ⇒ unset (null)" rule when an editor is emptied to "", "<p></p>",
// "<br>", or whitespace-only markup (see docs/dataModel.md).
export function isEmptyHtml(html: string | null | undefined): boolean {
  if (!html) return true;
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, "");
  return text.length === 0;
}

// Sanitise an editor value and collapse an empty one to null, so cleared fields
// persist as "unset" rather than as stray empty markup. The single normaliser
// used by both sidebars' onChange handlers and by server-side write paths.
export function htmlOrNull(html: string | null | undefined): string | null {
  const clean = sanitizeHtml(html);
  return isEmptyHtml(clean) ? null : clean;
}
