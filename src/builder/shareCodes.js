// shareCodes.js — blueprint share codes for Build-A-Dweeb.
//
// A build's config serialises to JSON, which we base64url-encode with a
// version prefix ("DW1."). Players can copy/paste the code to share builds.
// DOM-free; safe in node (uses Buffer when btoa/atob are absent).

export const SHARE_PREFIX = 'DW1.';

/** Encode a build config to a share code. Returns '' on failure. */
export function encodeConfig(config) {
  try {
    const json = JSON.stringify(config);
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    let b64;
    if (typeof g.btoa === 'function') {
      b64 = g.btoa(unescape(encodeURIComponent(json)));
    } else if (typeof g.Buffer !== 'undefined') {
      b64 = g.Buffer.from(json, 'utf8').toString('base64');
    } else {
      return '';
    }
    return SHARE_PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

/**
 * Decode a share code back to a config object.
 * Returns null for malformed codes. The caller validates the config shape.
 */
export function decodeConfig(code) {
  try {
    if (typeof code !== 'string' || !code.startsWith(SHARE_PREFIX)) return null;
    const b64 = code.slice(SHARE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    let json;
    if (typeof g.atob === 'function') {
      json = decodeURIComponent(escape(g.atob(b64)));
    } else if (typeof g.Buffer !== 'undefined') {
      json = g.Buffer.from(b64, 'base64').toString('utf8');
    } else {
      return null;
    }
    const cfg = JSON.parse(json);
    return cfg && typeof cfg === 'object' ? cfg : null;
  } catch {
    return null;
  }
}
