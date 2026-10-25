// GameModes.js — Definitions and rules for all three Dweeb game modes:
// 1. 'derby'   — Dumb Ways to Die (die in the craziest way possible, Darwin podium)
// 2. 'walldrop'— Team PVP Wall Drop Arena (1 life, slow arcing bullets, center dividing wall drops)
// 3. 'escape'  — Co-op Combatless Island Escape (parkour, heavy battery carrying, gate switches)
// 4. 'brawl'   — Classic Knockout Brawl

export const GAME_MODES = {
  derby: {
    id: 'derby',
    name: 'Dumb Ways to Die',
    tagline: 'Die in the most ridiculous way possible. Highest Darwin score wins!',
    stocks: 99,
    hasWeapons: true,
    hasWallDrop: false,
    hasContraptions: true,
    hasEscapePuzzles: false,
  },
  walldrop: {
    id: 'walldrop',
    name: 'Wall Drop PVP',
    tagline: 'Teams separated by a massive center wall. 1 Life. Wall drops... FIGHT!',
    stocks: 1,
    hasWeapons: true,
    hasWallDrop: true,
    hasContraptions: false,
    hasEscapePuzzles: false,
  },
  escape: {
    id: 'escape',
    name: 'Dweebscape Island',
    tagline: 'Combatless co-op escape room! Parkour, carry heavy batteries to power the portal.',
    stocks: 99,
    hasWeapons: false,
    hasWallDrop: false,
    hasContraptions: false,
    hasEscapePuzzles: true,
  },
  brawl: {
    id: 'brawl',
    name: 'Knockout Brawl',
    tagline: 'Classic 3-Stock Knockout Arena. Last Dweeb standing wins!',
    stocks: 3,
    hasWeapons: true,
    hasWallDrop: false,
    hasContraptions: true,
    hasEscapePuzzles: false,
  },
};

export const DEFAULT_MODE = 'derby';
