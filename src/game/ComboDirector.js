import { Hud } from '../ui/Hud.js';

// ComboDirector.js — tracks hit chains, juggles, team combos and assists for crowd-pleasing callouts.

export class ComboDirector {
  constructor({ hud, audio, particles }) {
    this.hud = hud;
    this.audio = audio;
    this.particles = particles;
    this.chains = new Map(); // victim -> { hits, lastTime, contributors: [{attacker, time}], victim }
    this.CHAIN_WINDOW = 1.6; // seconds
    this.MILESTONES = [3, 5, 8];
  }

  registerHit(victim, attacker, launch, time) {
    if (!victim || !attacker || attacker === victim) return;

    try {
      let chain = this.chains.get(victim);
      const isFresh = !chain || (time - chain.lastTime) > this.CHAIN_WINDOW;

      if (isFresh) {
        chain = { hits: 0, lastTime: time, contributors: [], victim };
        this.chains.set(victim, chain);
      }

      chain.hits++;
      chain.lastTime = time;

      // Track last 3 distinct attackers
      const existingIdx = chain.contributors.findIndex(c => c.attacker === attacker);
      if (existingIdx >= 0) {
        chain.contributors[existingIdx].time = time;
      } else {
        chain.contributors.push({ attacker, time });
        if (chain.contributors.length > 3) chain.contributors.shift();
      }

      // Determine tags
      const tags = [];
      const airborne = !victim.grounded;
      if (airborne && chain.hits >= 2) tags.push('JUGGLE');

      const distinctAttackers = chain.contributors.map(c => c.attacker);
      if (distinctAttackers.length >= 2) {
        const teams = distinctAttackers.map(a => a.team).filter(Boolean);
        const allSameTeam = teams.length >= 2 && teams.every(t => t === teams[0]);
        tags.push(allSameTeam ? 'TEAM COMBO' : 'ASSIST');
      }

      // Milestone callouts
      if (this.MILESTONES.includes(chain.hits)) {
        const attackerNames = distinctAttackers.map(a => Hud.nameTag?.(a) ?? a.name ?? 'Dweeb').join(' + ');
        const tagStr = tags.length ? tags.join(' · ') + ' · ' : '';
        const html = `x${chain.hits} ${tagStr}${attackerNames}`;
        this.hud?.feed?.(html, 'style');

        const primaryAttacker = chain.contributors[chain.contributors.length - 1]?.attacker;
        const color = primaryAttacker?.color ?? 0xffffff;
        const pos = victim.getPosition?.();
        if (pos) {
          this.hud?.popup?.(`x${chain.hits} COMBO!`, pos, chain.hits >= 5 ? 'big' : 'small', color);
        }

        // Rising sting + sparkle
        this.audio?.playUIClick?.();
        if (pos) this.particles?.sparkle?.(pos, color);
      }
    } catch { /* never throw */ }
  }

  registerKO(victim, credited, time) {
    if (!victim) return;

    try {
      const chain = this.chains.get(victim);
      if (!chain) return;

      // If the chain is still fresh and has other contributors besides credited
      if (credited && (time - chain.lastTime) <= this.CHAIN_WINDOW) {
        const others = chain.contributors
          .map(c => c.attacker)
          .filter(a => a !== credited);

        for (const assister of others) {
          this.hud?.feed?.(`ASSIST · ${Hud.nameTag?.(assister) ?? assister.name ?? 'Dweeb'}`, 'style');
          assister.assists = (assister.assists || 0) + 1;
        }
      }

      // Clear the chain for this victim
      this.chains.delete(victim);
    } catch { /* never throw */ }
  }

  update(dt) {
    try {
      const now = performance.now() / 1000; // match time comes from main loop
      for (const [victim, chain] of this.chains) {
        if (now - chain.lastTime > this.CHAIN_WINDOW) {
          this.chains.delete(victim);
        }
      }
    } catch { /* never throw */ }
  }

  reset() {
    this.chains.clear();
  }
}