// daily.js — Daily Contracts with progress, streaks, rewards.
// Pure logic + localStorage (key: 'dweebs-daily-v1').

const STORAGE_KEY = 'dweebs-daily-v1';

// ─── Contract definitions ───
// goal: 'win' | 'kos' | 'trickshots' | 'matches' | 'stylePeak'
// mode: specific mode id or null for any mode
// target: number to reach
// reward: { label, coins }
export const CONTRACTS = [
  { id: 'win_brawl', title: 'Win a Brawl', mode: 'brawl', goal: 'win', target: 1, reward: { label: 'Brawl Victor', coins: 150 } },
  { id: 'kos_5', title: 'Score 5 KOs in one match', mode: null, goal: 'kos', target: 5, reward: { label: 'KO Machine', coins: 200 } },
  { id: 'trickshots_2', title: 'Land 2 trickshots', mode: null, goal: 'trickshots', target: 2, reward: { label: 'Trickster', coins: 180 } },
  { id: 'matches_3', title: 'Play 3 matches', mode: null, goal: 'matches', target: 3, reward: { label: 'Regular', coins: 120 } },
  { id: 'style_300', title: 'Hit a 300 style peak', mode: null, goal: 'stylePeak', target: 300, reward: { label: 'Stylish', coins: 220 } },
  { id: 'win_derby', title: 'Win a Derby', mode: 'derby', goal: 'win', target: 1, reward: { label: 'Derby Champ', coins: 150 } },
  { id: 'win_walldrop', title: 'Win a Wall Drop', mode: 'walldrop', goal: 'win', target: 1, reward: { label: 'Wall Breaker', coins: 180 } },
  { id: 'kos_3_derby', title: 'Score 3 KOs in Derby', mode: 'derby', goal: 'kos', target: 3, reward: { label: 'Derby Dominator', coins: 160 } },
  { id: 'win_brawler', title: 'Win a Brawler Arena', mode: 'build_arena', goal: 'win', target: 1, reward: { label: 'Custom Victor', coins: 200 } },
  { id: 'style_200_any', title: 'Reach 200 style in any match', mode: null, goal: 'stylePeak', target: 200, reward: { label: 'Showoff', coins: 140 } },
];

const DAY_MS = 86400 * 1000;

/** Returns local YYYY-MM-DD string for today. */
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Deterministic hash pick for a given day key. */
export function contractFor(dayKey) {
  let hash = 0;
  for (let i = 0; i < dayKey.length; i++) {
    hash = ((hash << 5) - hash) + dayKey.charCodeAt(i);
    hash |= 0;
  }
  const idx = ((hash % CONTRACTS.length) + CONTRACTS.length) % CONTRACTS.length;
  return CONTRACTS[idx];
}

/** Read state from localStorage. Never throws. */
function readState(storage = globalThis?.localStorage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* ignore */ }
  return null;
}

/** Write state to localStorage. Never throws. */
function writeState(state, storage = globalThis?.localStorage) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

/** Get or create today's contract state. */
export function getDaily(storage = globalThis?.localStorage) {
  const day = todayKey();
  const contract = contractFor(day);
  const existing = readState(storage);

  if (existing && existing.day === day && existing.id === contract.id) {
    return { ...existing, contract };
  }

  // New day or different contract — reset progress, keep streak logic
  let streak = 0;
  let lastCompletedDay = null;
  if (existing) {
    streak = existing.streak ?? 0;
    lastCompletedDay = existing.lastCompletedDay ?? null;
  }

  const state = {
    day,
    id: contract.id,
    progress: 0,
    completed: false,
    claimed: false,
    streak,
    lastCompletedDay,
    coins: existing?.coins ?? 0, // lifetime wallet carries across days
  };
  writeState(state, storage);
  return { ...state, contract };
}

/** Update progress based on a completed match. */
export function recordMatch(payload, storage = globalThis?.localStorage) {
  // payload: { mode, win, kos, trickshots, stylePeak }
  const daily = getDaily(storage);
  if (daily.completed) return { ...daily, justCompleted: false };

  const { contract, progress: oldProgress } = daily;
  let newProgress = oldProgress;
  let justCompleted = false;

  // Check mode match
  const modeMatches = !contract.mode || contract.mode === payload.mode;

  if (!modeMatches) {
    // For mode-specific contracts, only progress if mode matches
    // For 'matches' goal, count all matches regardless of mode
    if (contract.goal !== 'matches') {
      writeState(daily, storage);
      return { ...daily, justCompleted: false };
    }
  }

  switch (contract.goal) {
    case 'win':
      if (modeMatches && payload.win) newProgress = 1;
      break;
    case 'kos':
      // Max per match
      if (modeMatches) newProgress = Math.max(newProgress, payload.kos ?? 0);
      break;
    case 'trickshots':
      // Max per match
      if (modeMatches) newProgress = Math.max(newProgress, payload.trickshots ?? 0);
      break;
    case 'matches':
      // Cumulative across all modes
      newProgress = oldProgress + 1;
      break;
    case 'stylePeak':
      // Max per match
      if (modeMatches) newProgress = Math.max(newProgress, payload.stylePeak ?? 0);
      break;
  }

  const completed = newProgress >= contract.target;
  const wasCompleted = oldProgress >= contract.target;

  if (completed && !wasCompleted) {
    justCompleted = true;
    // Streak logic
    const yesterday = todayKey(new Date(Date.now() - DAY_MS));
    if (daily.lastCompletedDay === yesterday) {
      daily.streak = (daily.streak ?? 0) + 1;
    } else {
      daily.streak = 1;
    }
    daily.lastCompletedDay = daily.day;
  }

  daily.progress = Math.min(newProgress, contract.target);
  daily.completed = completed;
  daily.claimed = daily.claimed && completed; // keep claimed if already claimed

  writeState(daily, storage);
  return { ...daily, contract, justCompleted };
}

/** Claim the reward. Returns updated state with coins added. */
export function claim(storage = globalThis?.localStorage) {
  const daily = getDaily(storage);
  if (!daily.completed || daily.claimed) return daily;

  daily.claimed = true;
  daily.coins = (daily.coins ?? 0) + daily.contract.reward.coins;
  writeState(daily, storage);
  return { ...daily, contract: daily.contract };
}

/** Get total accumulated coins across all days. */
export function getTotalCoins(storage = globalThis?.localStorage) {
  const state = readState(storage);
  return state?.coins ?? 0;
}

/** Reset daily state (for testing). */
export function resetDaily(storage = globalThis?.localStorage) {
  if (storage) storage.removeItem(STORAGE_KEY);
}