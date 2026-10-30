// news.js — hub news ticker content.
//
// Rotating tips, feature highlights, and dynamic callouts (nemesis, streaks).
// Pure strings; the painter lives in hub-extras.

import { getNemesis } from './nemesis.js';
import { getLifetimeStats } from './lifetime.js';

export const NEWS_ITEMS = [
  '💡 TIP: Hold punch to charge a mega punch — it launches dweebs into orbit!',
  '💡 TIP: Trickshots (KOs off bumpers) pay bonus style and fan coins.',
  '💡 TIP: Your nemesis remembers every loss. Beat them twice to flip the script.',
  '💡 TIP: Share your Build-A-Dweeb with a DW1. code — paste one to load a friend\'s build.',
  '💡 TIP: Bet fan coins on yourself in the arena. 2:1 payout!',
  '💡 TIP: Expedition caravans buy your surplus berries for gold.',
  '💡 TIP: Press plates in order to crack ruin vaults — or all at once in the Echo Chamber.',
  '🎖️ NEW: Lifetime stats track your career across every game.',
  '👹 NEW: Nemesis bots taunt you when they score the KO.',
  '🔥 NEW: The crowd hype meter — fill it for PANDEMONIUM!',
  '🤝 NEW: KO assists are tracked. Team Player achievement awaits.',
  '🔊 NEW: Dweebs bark now. Listen for the victory yelp.',
];

/** Dynamic items based on the player's state. */
export function dynamicNews() {
  const items = [];
  try {
    const n = getNemesis();
    if (n) items.push(`👹 Your nemesis ${n.name} is ${n.wins}-${n.losses} against you. Revenge is a dish best served launched.`);
  } catch { /* no storage */ }
  try {
    const s = getLifetimeStats();
    if (s.matches > 0) items.push(`📊 Career: ${s.wins}/${s.matches} wins, ${s.kos} KOs, ${s.coins} fan coins.`);
  } catch { /* no storage */ }
  return items;
}

/** All ticker items: dynamic first, then static. */
import { friendActivity } from './friends.js';

export function allNews(date = new Date()) {
  const friends = friendActivity(date).map(f => 
    `${f.emoji} ${f.friend} ${f.activity} (${f.time})`
  );
  return [...friends, ...dynamicNews(), ...NEWS_ITEMS];
}
