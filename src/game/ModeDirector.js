// ModeDirector.js — scripted, telegraphed per-mode beats on top of the round loop.
// Every event warns ~2s ahead (banner + pulsing target rings on the ground where it will land),
// then fires. Rings that track a Dweeb lock in place when the warning ends, so it's dodgeable.
// Only runs while the match is live; timers are on match time, so pause and hitstop freeze it.
// (First draft by Nemotron; schedule/queue/targeting rewritten in review.)

const WARN = 2;

const pickActive = ctx => (ctx.dweebs || []).filter(d => d && d.active && !d.eliminated);
const mostHurt = ctx => pickActive(ctx).reduce((a, b) => (!a || b.percent > a.percent ? b : a), null);
const leader = ctx => pickActive(ctx).reduce((a, b) => (!a || (b.kos ?? 0) > (a.kos ?? 0) || ((b.kos ?? 0) === (a.kos ?? 0) && b.percent < a.percent) ? b : a), null);

const EVENTS = {
  derby: [
    {
      id: 'meteorMelons', every: 22, warn: 'METEOR MELONS!',
      targets(ctx) { return [0, 1, 2, 3].map(() => ctx.arena?.randomGroundPoint?.(8)).filter(Boolean); },
      fire(ctx, pts) { pts.forEach((p, i) => ctx.later(i * 0.25, () => ctx.arena?.spawnItem?.('explodingMelon', { x: p.x, y: 14, z: p.z }))); },
    },
    {
      id: 'anvilAlert', every: 37, warn: 'ANVIL ALERT!',
      track: leader,
      fire(ctx, pts) { const p = pts[0]; if (p) ctx.arena?.spawnItem?.('anvil', { x: p.x, y: 13, z: p.z }); },
    },
    { id: 'supplyDrop', every: 40, warn: 'SUPPLY DROP', fire(ctx) { ctx.arena?.spawnPowerUp?.(); } },
  ],
  brawl: [
    {
      id: 'crowdFavor', every: 30, warn: 'CROWD FAVOR!',
      track: mostHurt,
      fire(ctx, pts) {
        // Comeback gift lands right next to whoever is taking the beating
        const pu = ctx.arena?.spawnPowerUp?.();
        const p = pts[0];
        if (pu && p) { pu.x = p.x + 0.8; pu.z = p.z; pu.group.position.x = pu.x; pu.group.position.z = pu.z; }
        ctx.arena?.excite?.(0.6);
      },
    },
    {
      id: 'anvilAlert', every: 45, warn: 'ANVIL ALERT!',
      track: leader,
      fire(ctx, pts) { const p = pts[0]; if (p) ctx.arena?.spawnItem?.('anvil', { x: p.x, y: 13, z: p.z }); },
    },
  ],
  walldrop: [
    {
      id: 'supplyPods', at: 45, warn: 'SUPPLY PODS INCOMING',
      targets() { return [{ x: -6, z: 0 }, { x: 6, z: 0 }]; },
      fire(ctx, pts) { for (const p of pts) ctx.arena?.spawnItem?.('explodingMelon', { x: p.x, y: 10, z: p.z }); },
    },
    {
      id: 'itemRain', every: 35, warn: 'ITEM RAIN',
      fire(ctx) { for (let i = 0; i < 3; i++) ctx.later(i * 0.35, () => ctx.arena?.dropRandomItem?.(ctx.match.time)); },
    },
  ],
};

export class ModeDirector {
  constructor() { this.reset(); }

  start(modeId) {
    this.modeId = modeId;
    this.schedule = EVENTS[modeId] ?? [];
    this.queue = [];
    this.state = new Map(this.schedule.map(ev => [ev.id, { nextAt: ev.at ?? ev.every, warned: false, pts: [], who: null }]));
  }

  update(dt, ctx) {
    if (!ctx.match?.running || !this.schedule?.length) return;
    const t = ctx.match.time;
    ctx.later = (delay, fn) => this.queue.push({ at: t + delay, fn });

    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (t < this.queue[i].at) continue;
      const q = this.queue.splice(i, 1)[0];
      try { q.fn(); } catch (e) { console.warn('[ModeDirector] queued action error:', e); }
    }

    this._ringT = (this._ringT ?? 0) - dt;
    const ring = this._ringT <= 0;
    if (ring) this._ringT = 0.28;

    for (const ev of this.schedule) {
      const st = this.state.get(ev.id);
      if (!st || !Number.isFinite(st.nextAt)) continue;
      if (!st.warned && t >= st.nextAt - WARN) {
        st.warned = true;
        st.who = ev.track ? ev.track(ctx) : null;
        st.pts = ev.targets ? ev.targets(ctx) : [];
        ctx.hud?.announce?.(ev.warn, '', 1.6);
        ctx.audio?.playUIClick?.();
      }
      if (st.warned && t < st.nextAt) {
        // Tracking target follows its Dweeb until the last half second, then locks
        if (st.who && t < st.nextAt - 0.5) { const p = st.who.getPosition(); st.pts = [{ x: p.x, y: p.y - 0.45, z: p.z }]; }
        if (ring) for (const p of st.pts) ctx.particles?.ring?.({ x: p.x, y: (p.y ?? 0) + 0.1, z: p.z }, { color: 0xff4d5e, size: 2.2, life: 0.3 });
      }
      if (st.warned && t >= st.nextAt) {
        try { ev.fire(ctx, st.pts); } catch (e) { console.warn('[ModeDirector] event error:', e); }
        st.warned = false;
        st.nextAt = ev.every ? st.nextAt + ev.every : Infinity;
      }
    }
  }

  reset() {
    this.modeId = null;
    this.schedule = null;
    this.state = new Map();
    this.queue = [];
  }
}
