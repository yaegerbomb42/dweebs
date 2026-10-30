// cards.js — dweeb trading cards.
//
// Collect cards by winning matches. Each card has rarity.

export const RARITIES = {
  common: { name: 'Common', icon: '⚪', weight: 60 },
  rare: { name: 'Rare', icon: '🔵', weight: 25 },
  epic: { name: 'Epic', icon: '🟣', weight: 10 },
  legendary: { name: 'Legendary', icon: '🟡', weight: 5 },
};

export const CARD_KEY = 'dweebs-cards-v1';

function read() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CARD_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function write(cards) {
  try {
    localStorage.setItem(CARD_KEY, JSON.stringify(cards));
  } catch { /* private mode */ }
}

/** Get the collection. */
export function getCards() {
  return read();
}

/**
 * Draw a random card.
 * @param {function} rng
 * @returns {{dweeb, rarity}}
 */
export function drawCard(rng = Math.random) {
  const total = Object.values(RARITIES).reduce((s, r) => s + r.weight, 0);
  let roll = rng() * total;
  let rarity = 'common';
  for (const [id, r] of Object.entries(RARITIES)) {
    roll -= r.weight;
    if (roll <= 0) { rarity = id; break; }
  }
  // Random dweeb name.
  const names = ['Blitz', 'Gizmo', 'Pip', 'Zed', 'Moxie', 'Tango', 'Rocco', 'Luna'];
  const dweeb = names[Math.floor(rng() * names.length)];
  return { dweeb, rarity, id: `${dweeb}-${Date.now()}-${Math.floor(rng() * 1000)}` };
}

/** Add a card to the collection. */
export function addCard(card) {
  const cards = read();
  cards.push(card);
  write(cards);
  return cards;
}

/** Count by rarity. */
export function countByRarity() {
  const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (const c of read()) {
    if (counts[c.rarity] != null) counts[c.rarity]++;
  }
  return counts;
}
