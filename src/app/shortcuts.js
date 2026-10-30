// shortcuts.js — keyboard shortcut reference.

export const SHORTCUTS = [
  { key: 'T', action: 'Taunt', context: 'Arena' },
  { key: 'M', action: 'Toggle switcher', context: 'Arena' },
  { key: '←/→', action: 'Spectate', context: 'Arena (when out)' },
  { key: '1-4', action: 'Recruit units', context: 'Warfare' },
  { key: 'Q', action: 'Artillery', context: 'Warfare' },
  { key: 'E', action: 'Supply drop', context: 'Warfare' },
  { key: 'R', action: 'Toggle formation', context: 'Warfare' },
  { key: 'F', action: 'Fortify', context: 'Warfare' },
  { key: 'N', action: 'Rename hero', context: 'Warfare' },
  { key: 'U/I', action: 'Commander powers', context: 'Warfare' },
  { key: 'Esc', action: 'Cancel/pause', context: 'All' },
];

/** Format shortcuts for display. */
export function formatShortcuts() {
  return SHORTCUTS.map(s => `${s.key}: ${s.action} (${s.context})`);
}
