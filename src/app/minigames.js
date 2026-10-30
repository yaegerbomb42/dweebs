// minigames.js — hub mini-games.
//
// Quick playable games in the hub.

export const MINIGAMES = {
  clicker: {
    name: 'Dweeb Clicker', icon: '👆',
    desc: 'Click the dweeb as many times as you can in 10s',
    duration: 10,
  },
  memory: {
    name: 'Memory Match', icon: '🧠',
    desc: 'Match dweeb pairs',
    pairs: 6,
  },
  reaction: {
    name: 'Reaction Test', icon: '⚡',
    desc: 'Click when the light turns green',
  },
};

export class ClickerGame {
  constructor() {
    this.clicks = 0;
    this.active = false;
    this.startTime = 0;
  }

  start() {
    this.clicks = 0;
    this.active = true;
    this.startTime = Date.now();
  }

  click() {
    if (!this.active) return 0;
    if (this.remaining() <= 0) {
      this.active = false;
      return this.clicks;
    }
    this.clicks++;
    return this.clicks;
  }

  remaining() {
    if (!this.active) return 0;
    const elapsed = (Date.now() - this.startTime) / 1000;
    return Math.max(0, 10 - elapsed);
  }
}
