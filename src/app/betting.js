// betting.js — arena betting: wager fan coins on your own victory.
//
// A persistent coin balance (localStorage `dweebs-fan-coins-v1`). Place a bet
// before a match; winning pays 2:1. Bankruptcy grants pity coins so the fun
// never hard-stops. DOM-free and storage-guarded for node tests.

export const BETTING_KEY = 'dweebs-fan-coins-v1';
export const STARTING_COINS = 100;
export const PITY_COINS = 50;
export const MIN_WAGER = 10;

function readState() {
  try {
    if (typeof localStorage === 'undefined') return { coins: STARTING_COINS };
    const raw = localStorage.getItem(BETTING_KEY);
    if (!raw) return { coins: STARTING_COINS };
    const parsed = JSON.parse(raw) || {};
    return { coins: Math.max(0, Math.floor(parsed.coins ?? STARTING_COINS)) };
  } catch {
    return { coins: STARTING_COINS };
  }
}

function writeState(state) {
  try {
    localStorage.setItem(BETTING_KEY, JSON.stringify(state));
  } catch { /* private mode */ }
}

/** Current coin balance. Grants pity coins if bankrupt. */
export function getCoins() {
  const s = readState();
  if (s.coins < MIN_WAGER) {
    s.coins += PITY_COINS;
    writeState(s);
  }
  return s.coins;
}

/**
 * Place a bet: deducts the wager now. Returns {ok, wager} or {ok:false, reason}.
 */
export function placeBet(wager) {
  const w = Math.floor(wager);
  if (!Number.isFinite(w) || w < MIN_WAGER) return { ok: false, reason: 'min' };
  const s = readState();
  if (w > s.coins) return { ok: false, reason: 'funds' };
  s.coins -= w;
  writeState(s);
  return { ok: true, wager: w };
}

/**
 * Resolve a bet after the match. Win pays 2:1 (wager back + equal profit).
 * @returns {{coins:number, profit:number}} profit is net (negative on loss)
 */
export function resolveBet(wager, won) {
  const s = readState();
  let profit;
  if (won) {
    s.coins += wager * 2;
    profit = wager;
  } else {
    profit = -wager;
  }
  writeState(s);
  return { coins: s.coins, profit };
}

/** Payout multiplier shown in the UI. */
export const PAYOUT = '2:1';
