// Minimal property-list writer and reader for Poolside's saved-session files.
//
// The file is a plist because the reference tool used .plist files for session material and the
// user asked to keep that on-disk shape. Only the subset this application writes is supported, and
// the reader is deliberately strict: it extracts exactly one <data> payload and ignores the rest,
// so a malformed or hand-edited document fails loudly instead of half-parsing.
//
// Pure module: no filesystem, no Electron. Enforced by test/architecture.test.cjs.

const ENTITIES = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, character => ENTITIES[character]);
}

/**
 * Serialise one saved-session document.
 * @param {{format: string, scope: string, accountId: string, name: string, role: string, browserProfile: string, cookieCount: number, savedAt: string, secret: string}} fields
 * @returns {string}
 */
function buildDocument(fields) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0"><dict>\n` +
    `<key>Format</key><string>${escapeXml(fields.format)}</string>\n` +
    `<key>Scope</key><string>${escapeXml(fields.scope)}</string>\n` +
    `<key>AccountID</key><string>${escapeXml(fields.accountId)}</string>\n` +
    `<key>Name</key><string>${escapeXml(fields.name)}</string>\n` +
    `<key>Role</key><string>${escapeXml(fields.role)}</string>\n` +
    `<key>BrowserProfile</key><string>${escapeXml(fields.browserProfile)}</string>\n` +
    `<key>CookieCount</key><integer>${fields.cookieCount}</integer>\n` +
    `<key>SavedAt</key><date>${escapeXml(fields.savedAt)}</date>\n` +
    `<key>EncryptedSession</key><data>${fields.secret}</data>\n` +
    `</dict></plist>\n`
  );
}

/**
 * Extract the base64 payload from a document, or null when there is none.
 * @param {unknown} xml
 * @returns {string|null}
 */
function readEncryptedPayload(xml) {
  if (typeof xml !== 'string') return null;
  const encoded = xml.match(/<key>EncryptedSession<\/key>\s*<data>([A-Za-z0-9+/=\s]+)<\/data>/)?.[1];
  return encoded ? encoded.replace(/\s/g, '') : null;
}

/**
 * Read a scalar string field, for diagnostics and tests.
 * @param {unknown} xml
 * @param {unknown} key
 * @returns {string|null}
 */
function readStringField(xml, key) {
  if (typeof xml !== 'string' || typeof key !== 'string') return null;
  const pattern = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`);
  return xml.match(pattern)?.[1] ?? null;
}

module.exports = { buildDocument, readEncryptedPayload, readStringField, escapeXml };
