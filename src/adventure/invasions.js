// invasions.js — boss invasion events for Expedition & Dynasty.
//
// Every few minutes a boss lumbers toward the village: a warning goes out, the
// boss spawns as a hostile critter (so Defenders and plush cannons fight it with
// the existing combat), it smashes structures until killed or bored, and victory
// pays loot. Pure logic — the world (Meadowlands) supplies the critter factory
// and structure adapters through ctx, which keeps this fully testable.

export const BOSS_TYPES = {
  grumblor: {
    id: 'grumblor', name: 'Grumblor the Devourer', icon: '🐛',
    hp: 40, speed: 1.2, dmg: 8, attackRange: 3.5, attackInterval: 2.5,
    loot: { gold: 15, stone: 10 },
    blurb: 'A mountain of grumbling chitin. It eats buildings.',
  },
  skitter: {
    id: 'skitter', name: 'Queen Skitter', icon: '🦋',
    hp: 22, speed: 3.2, dmg: 4, attackRange: 2.5, attackInterval: 1.8,
    loot: { gold: 10, berries: 15 },
    blurb: 'Fast, furious, and after your pantry.',
  },
  mudking: {
    id: 'mudking', name: 'The Mud King', icon: '🟤',
    hp: 30, speed: 2.0, dmg: 6, attackRange: 3, attackInterval: 2.2,
    loot: { gold: 12, wood: 12 },
    blurb: 'He wants your village. Specifically the muddy parts.',
  },
};

const BOSS_IDS = Object.keys(BOSS_TYPES);

export class InvasionManager {
  /**
   * @param {object} opts
   * @param {number} opts.firstInvasionAt seconds until the first invasion
   * @param {number} opts.minInterval / maxInterval seconds between invasions
   * @param {number} opts.warnTime seconds of warning before the boss spawns
   * @param {number} opts.maxActiveTime seconds before the boss gets bored
   * @param {() => number} opts.rng random source (injectable for tests)
   */
  constructor(opts = {}) {
    this.firstInvasionAt = opts.firstInvasionAt ?? 180;
    this.minInterval = opts.minInterval ?? 300;
    this.maxInterval = opts.maxInterval ?? 480;
    this.warnTime = opts.warnTime ?? 30;
    this.maxActiveTime = opts.maxActiveTime ?? 300;
    this.rng = opts.rng ?? Math.random;
    this.state = 'idle'; // idle | warned | active
    this.nextIn = this.firstInvasionAt;
    this.timer = 0;
    this.bossType = null;
    this.bossCritter = null;
    this.attackTimer = 0;
    this.destroyedCount = 0;
    this.invasionsSeen = 0;
  }

  /**
   * Advance the invasion state machine.
   * @param {number} dt seconds
   * @param {object} ctx
   * @param {object} ctx.colony the Colony (resources, citizens, _addLog)
   * @param {object[]} ctx.critters live critter list (boss tracked by reference)
   * @param {(type) => object} ctx.spawnBoss create the boss critter, return it
   * @param {(c) => void} ctx.removeCritter
   * @param {() => object[]} ctx.structures live structures {x,z,hp,label}
   * @param {(s, n) => void} ctx.damageStructure
   * @param {(e) => void} ctx.onEvent event sink {type, ...}
   */
  update(dt, ctx) {
    if (this.state === 'idle') {
      this.nextIn -= dt;
      const citizens = ctx.colony?.citizens?.length ?? 0;
      if (this.nextIn <= 0 && citizens >= 3) {
        this.state = 'warned';
        this.timer = this.warnTime;
        this.bossType = BOSS_TYPES[BOSS_IDS[Math.floor(this.rng() * BOSS_IDS.length)]];
        ctx.onEvent?.({ type: 'invasionWarn', boss: this.bossType.id, seconds: this.warnTime });
        ctx.colony._addLog(`⚠️ ${this.bossType.icon} ${this.bossType.name} approaches! ${this.warnTime}s to man the defenses!`);
      }
      return;
    }
    if (this.state === 'warned') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.bossCritter = ctx.spawnBoss(this.bossType);
        this.state = 'active';
        this.timer = this.maxActiveTime;
        this.attackTimer = 0;
        this.destroyedCount = 0;
        this.invasionsSeen++;
        ctx.onEvent?.({ type: 'invasionSpawn', boss: this.bossType.id });
        ctx.colony._addLog(`${this.bossType.icon} ${this.bossType.name} has arrived! ${this.bossType.blurb}`);
      }
      return;
    }
    // ── active ──
    const boss = this.bossCritter;
    if (!boss || boss.hp <= 0 || !ctx.critters.includes(boss)) {
      this._victory(ctx);
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this._retreat(ctx, `${this.bossType.icon} ${this.bossType.name} grew bored and lumbered back into the wilds.`);
      return;
    }
    const structs = ctx.structures().filter(s => !s.destroyed && (s.hp ?? 1) > 0);
    let target = null;
    let best = Infinity;
    for (const s of structs) {
      const d = Math.hypot(s.x - boss.x, s.z - boss.z);
      if (d < best) { best = d; target = s; }
    }
    if (target && best <= this.bossType.attackRange) {
      this.attackTimer += dt;
      if (this.attackTimer >= this.bossType.attackInterval) {
        this.attackTimer = 0;
        ctx.damageStructure(target, this.bossType.dmg);
        ctx.onEvent?.({ type: 'invasionHit', boss: this.bossType.id, structure: target.label });
        if ((target.hp ?? 1) <= 0) {
          this.destroyedCount++;
          ctx.onEvent?.({ type: 'invasionDestroy', boss: this.bossType.id, structure: target.label });
          ctx.colony._addLog(`💥 ${this.bossType.name} smashed the ${target.label}!`);
          if (this.destroyedCount >= 3) {
            this._retreat(ctx, `${this.bossType.icon} ${this.bossType.name} smashed its fill and left.`);
            return;
          }
        }
      }
    } else {
      // Stomp toward the target, or the campfire if nothing stands.
      const tx = target ? target.x : 0;
      const tz = target ? target.z : 0;
      const dx = tx - boss.x;
      const dz = tz - boss.z;
      const len = Math.hypot(dx, dz) || 1;
      boss.x += (dx / len) * this.bossType.speed * dt;
      boss.z += (dz / len) * this.bossType.speed * dt;
      if (boss.mesh) {
        boss.mesh.position.x = boss.x;
        boss.mesh.position.z = boss.z;
      }
    }
  }

  _victory(ctx) {
    const loot = this.bossType.loot;
    for (const [res, n] of Object.entries(loot)) {
      if (typeof ctx.colony.addResource === 'function') ctx.colony.addResource(res, n);
      else ctx.colony.resources[res] = (ctx.colony.resources[res] || 0) + n;
    }
    const lootStr = Object.entries(loot).map(([r, n]) => `+${n} ${r}`).join(', ');
    ctx.colony._addLog(`🎉 ${this.bossType.icon} ${this.bossType.name} DEFEATED! Loot: ${lootStr}.`);
    ctx.onEvent?.({ type: 'invasionVictory', boss: this.bossType.id, loot });
    this._reset();
  }

  _retreat(ctx, message) {
    if (this.bossCritter) ctx.removeCritter(this.bossCritter);
    ctx.colony._addLog(message);
    ctx.onEvent?.({ type: 'invasionRetreat', boss: this.bossType?.id });
    this._reset();
  }

  _reset() {
    this.state = 'idle';
    this.bossCritter = null;
    this.bossType = null;
    this.nextIn = this.minInterval + this.rng() * (this.maxInterval - this.minInterval);
  }

  /** Plain-data snapshot for save files. */
  serialize() {
    return {
      state: this.state,
      nextIn: this.nextIn,
      timer: this.timer,
      bossType: this.bossType?.id ?? null,
      bossHp: this.bossCritter?.hp ?? null,
      invasionsSeen: this.invasionsSeen,
    };
  }
}
