// colony.js — Civilization management, dynasty lineage, knowledge totem, and off-screen events

import { Citizen, PERSONALITIES } from './citizen.js';

export class Colony {
  constructor() {
    this.name = 'New Dweebtopia';
    this.generation = 1;
    this.citizens = [];
    this.unlockedVerbs = new Set(['carry']); // everyone starts with basic physical carrying
    this.historyLog = [];
    this.resources = {
      wood: 12,
      berries: 20,
      stone: 8,
    };
    this.expeditionTimer = 0;

    this._addLog('The dawn of New Dweebtopia. The first settlement is founded in The Meadowlands.');
  }

  _addLog(message) {
    const entry = {
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      text: message,
    };
    this.historyLog.unshift(entry);
    if (this.historyLog.length > 50) this.historyLog.pop();
  }

  addCitizen(dweeb, config = {}) {
    const citizen = new Citizen(dweeb, {
      ...config,
      knownVerbs: Array.from(this.unlockedVerbs),
    });
    this.citizens.push(citizen);
    this._addLog(`${citizen.name} joined the settlement as a ${citizen.personality.name}.`);
    return citizen;
  }

  unlockVerb(verbId, discovererName = 'The Pioneer') {
    if (this.unlockedVerbs.has(verbId)) return false;
    this.unlockedVerbs.add(verbId);
    this._addLog(`✨ BREAKTHROUGH: ${discovererName} inscribed the ${verbId.toUpperCase()} verb onto the Totem of Knowledge!`);

    // Discovered verb spreads to active citizens
    for (const c of this.citizens) {
      if (Math.random() > 0.4) {
        c.learnVerb(verbId);
      }
    }
    return true;
  }

  update(dt, world) {
    // 1. Update all autonomous citizens
    for (const citizen of this.citizens) {
      citizen.update(dt, world, this.citizens);
    }

    // 2. Periodic off-screen emergent civilization adventures (every ~25 seconds)
    this.expeditionTimer += dt;
    if (this.expeditionTimer >= 25) {
      this.expeditionTimer = 0;
      this._simulateEmergentEvent(world);
    }
  }

  _simulateEmergentEvent(world) {
    if (this.citizens.length === 0) return;
    const actor = this.citizens[Math.floor(Math.random() * this.citizens.length)];

    const events = [
      () => {
        this.resources.berries += 5;
        this._addLog(`🍓 ${actor.name} returned from the riverbank with a basket of fresh wild berries.`);
      },
      () => {
        this.resources.wood += 3;
        this._addLog(`🪵 ${actor.name} dragged a sturdy fallen timber branch back to the workshop.`);
      },
      () => {
        if (!this.unlockedVerbs.has('bounce')) {
          this._addLog(`🔍 ${actor.name} surveyed the Ancient Ruin and spotted spring mechanisms near the gate.`);
        } else {
          this._addLog(`🚀 ${actor.name} demonstrated high-altitude bouncing from the Lookout Bluff!`);
        }
      },
      () => {
        this.resources.stone += 2;
        this._addLog(`🪨 ${actor.name} unearthed strange mineral quartz near the cavern entrance.`);
      },
      () => {
        const friend = this.citizens[Math.floor(Math.random() * this.citizens.length)];
        if (friend !== actor) {
          this._addLog(`💬 ${actor.name} and ${friend.name} stayed up late by the fire discussing future expeditions.`);
        }
      },
    ];

    const pick = events[Math.floor(Math.random() * events.length)];
    pick();
  }

  passGeneration() {
    this.generation++;
    this._addLog(`📜 A new era begins! Generation ${this.generation} takes the helm of ${this.name}.`);
    // Heirs inherit knowledge and traits
    for (const c of this.citizens) {
      for (const v of this.unlockedVerbs) {
        c.learnVerb(v);
      }
    }
  }
}
