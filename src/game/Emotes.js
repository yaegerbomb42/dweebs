// Emotes.js — six quick emotes on the number row (1–6), for the player and the bots.
//
// They're a risk/reward verb, not just decoration:
//   • Taunting a rival within 9 m earns style and gets the crowd going; taunting within 3 s of
//     your own KO is DISRESPECT (big style). Bots you taunt may come for you.
//   • Getting hit mid-emote is CAUGHT SLIPPING! — the attacker gets the style instead.
// Bots emote after their KOs (show-offs more), cheer when a teammate scores, and sweat at 120%+.
// Presentation lives in Dweeb._animate / DweebModel face (reads d.emote / d.emoteT).

export const EMOTES = {
  taunt: { key: 'Digit1', label: 'NYAH NYAH!', t: 1.4, mood: 'smug',    taunt: true },
  cheer: { key: 'Digit2', label: 'WOOO!',      t: 1.3, mood: 'smug' },
  dance: { key: 'Digit3', label: '♪ ♫ ♪',      t: 2.0, mood: 'smug',    taunt: true },
  sweat: { key: 'Digit4', label: 'uh oh…',     t: 1.4, mood: 'worried' },
  gg:    { key: 'Digit5', label: 'GG!',        t: 1.4, mood: 'calm' },
  flex:  { key: 'Digit6', label: 'BEHOLD!',    t: 1.5, mood: 'grumpy',  taunt: true },
};
const BY_CODE = Object.fromEntries(Object.entries(EMOTES).map(([id, e]) => [e.key, id]));

export class EmoteSystem {
  constructor({ hud, combat, arena, audio }) {
    this.hud = hud; this.combat = combat; this.arena = arena; this.audio = audio;
    this.dweebs = []; this.bots = []; this.player = null;
    this.enabled = false;
    this._onKey = this._onKey.bind(this);
    window.addEventListener('keydown', this._onKey);
  }

  setActors(dweebs, bots, player) { this.dweebs = dweebs || []; this.bots = bots || []; this.player = player; }

  _onKey(e) {
    if (!this.enabled || e.repeat) return;
    const id = BY_CODE[e.code];
    if (!id || !this.player) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    this.start(this.player, id);
  }

  start(d, id) {
    const E = EMOTES[id];
    if (!E || !d || !d.active || !d.canAct || d.held || d.grabbedBy || !d.grounded) return false;
    if (d.emoteCd > 0) return false;
    d.emote = id;
    d.emoteT = E.t;
    d.emoteMax = E.t;
    d.emoteCd = E.t + 0.6;
    d.emoteMood = E.mood;
    d.emotePct = d.percent;
    d.landSquash = -0.3; // little hop into it
    this.hud?.popup?.(E.label, { ...d.getPosition(), y: d.getPosition().y + 1.4 }, 'small', d.color ?? 0xffffff);
    if (E.taunt) this._taunt(d);
    if (id === 'cheer' || id === 'dance') this.audio?.playCheer?.(0.3);
    return true;
  }

  _taunt(d) {
    const p = d.getPosition();
    let near = null, nd = 9;
    for (const o of this.dweebs) {
      if (o === d || !o.active || (d.team && o.team === d.team)) continue;
      const op = o.getPosition(), dist = Math.hypot(op.x - p.x, op.z - p.z);
      if (dist < nd) { nd = dist; near = o; }
    }
    if (!near) return;
    const t = this.combat?.time ?? 0;
    const disrespect = d.lastKOTime != null && t - d.lastKOTime < 3;
    this.combat?.addStyle?.(d, disrespect ? 14 : 4, disrespect ? 'DISRESPECT' : 'TAUNT');
    this.arena?.excite?.(disrespect ? 0.7 : 0.3);
    // A taunted bot might drop everything and come for you
    for (const b of this.bots) if (b.dweeb === near && Math.random() < 0.7) { b.target = near.botTarget = d; b.grudge = Math.max(b.grudge ?? 1, 1.4); }
    near.reactKind = 'dread'; // eyes snap to the taunter if Reactions (#20) is present
  }

  /** A KO happened: remember it for DISRESPECT, and let bots celebrate / teammates cheer. */
  onKO(victim, credited) {
    if (!credited) return;
    credited.lastKOTime = this.combat?.time ?? 0;
    const bot = this.bots.find(b => b.dweeb === credited);
    if (bot) {
      const show = bot.roleKey === 'showoff' ? 0.9 : 0.45;
      if (Math.random() < show) setTimeout(() => this.start(credited, ['taunt', 'dance', 'flex', 'cheer'][Math.floor(Math.random() * 4)]), 350);
    }
    for (const b of this.bots) {
      const d = b.dweeb;
      if (d !== credited && d.team && d.team === credited.team && Math.random() < 0.5) setTimeout(() => this.start(d, 'cheer'), 500 + Math.random() * 400);
    }
  }

  /** Call after bots think and before Dweeb.preStep. */
  update(dt) {
    for (const d of this.dweebs) {
      if (!d) continue;
      if (d.emoteCd > 0) d.emoteCd -= dt;
      if (!(d.emoteT > 0)) continue;
      // Hit while showing off
      if (d.percent > (d.emotePct ?? d.percent) + 0.5 || d.hitstun > 0 || d.ragdolling) {
        const by = d.lastHitBy;
        if (by && by !== d) {
          this.hud?.popup?.('CAUGHT SLIPPING!', d.getPosition(), 'big', by.color ?? 0xffffff);
          this.combat?.addStyle?.(by, 10, 'CAUGHT SLIPPING');
        }
        this._end(d); continue;
      }
      const isBot = !d.isPlayer;
      // The player cancels by moving or acting; bots are held still for the emote
      if (!isBot && (d.moveInput.lengthSq() > 0.05 || d.isCharging || d.held || !d.grounded)) { this._end(d); continue; }
      if (isBot) d.moveInput.set(0, 0);
      d.emoteT -= dt;
      if (d.emoteT <= 0) this._end(d);
    }
    // Bots sweat when they're on the brink
    if (Math.random() < dt * 0.15) {
      for (const b of this.bots) {
        const d = b.dweeb;
        if (d.active && d.percent > 120 && !d.isCharging && !d.held && Math.random() < 0.25) this.start(d, 'sweat');
      }
    }
  }

  _end(d) { d.emote = null; d.emoteT = 0; d.emoteMood = null; }

  dispose() { window.removeEventListener('keydown', this._onKey); }
}
