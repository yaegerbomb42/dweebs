// dom.js — the three tiny DOM helpers the shell needs. APP-owned.

/** Build one element from an HTML string. */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Build a document fragment from an HTML string. */
export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content;
}

/**
 * Show or hide a message node in place.
 * Passing '' clears and hides it, so callers never need the null check.
 */
export function setMsg(node, msg) {
  if (!node) return;
  node.textContent = msg || '';
  node.classList.toggle('hidden', !msg);
}

/** Toggle a segmented control (the .seg pattern Lead already styles). */
export function setSeg(seg, value) {
  if (!seg) return;
  for (const b of seg.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === String(value));
  }
}

/** Read a segmented control's current value. */
export function segValue(seg) {
  return seg?.querySelector('button.on')?.dataset.v ?? null;
}

/** The invite link a player shares. Hash routing means no server round-trip. */
export function inviteLink(code) {
  return location.origin + location.pathname + location.search + '#/room/' + code;
}
