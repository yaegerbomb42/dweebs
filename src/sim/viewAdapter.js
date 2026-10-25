// viewAdapter.js — T1: translate SimState + SimEvents into what the legacy view needs.
// The legacy view (Dweeb meshes, Hud cards, Fx, Announcer, CameraController) reads live
// objects with getPosition()/percent/stocks/active. This adapter exposes the same shape
// as read-only projections over SimState, plus an EventBus wiring helper that maps sim
// event types onto the legacy Fx/Hud/Audio callbacks. No three.js here: callers pass
// their own live objects; this file only computes numbers/strings.
import { EventBus } from './events.js';
import { BALANCE } from '../game/Balance.js';
// Read-only dweeb projection: {id,slot,name,type,color,pos:[x,y,z],vel,yaw,percent,
// stocks,active,out,eliminated,grounded,styleTier,mega,bubble,charging,held}.
export function projectDweebs(state) { return state.dweebs; }
export function projectItems(state) { return state.items; }
// Blast-margin for near-miss teases / HUD warnings (metres to the nearest KO plane).
export function blastMargin(pos, blastSide = BALANCE.match.blastSide, blastTop = BALANCE.match.blastTop, waterLevel = -5) {
  const radial = blastSide - Math.hypot(pos[0], pos[2]);
  const top = blastTop - pos[1];
  return Math.min(radial, top);
}
// Leader for spectate-cam: most stocks, then lowest percent (mirrors Match standings).
export function pickSpectate(dweebs) {
  let best = null;
  for (const d of dweebs) {
    if (!d.active || d.out || d.eliminated) continue;
    if (!best || d.stocks > best.stocks || (d.stocks === best.stocks && d.percent < best.percent)) best = d;
  }
  return best;
}
// Map sim events onto legacy view callbacks ({fx,hud,audio,announce}).
// announce(line, context) formats KO feed lines; every handler is optional.
export function wireSimEvents(bus, view = {}) {
  const { fx, hud, audio, announce } = view;
  const on = (type, fn) => bus.on(type, fn);
  const offs = [];
  offs.push(on('hit', e => { fx?.hitAt?.({ x: e.x, y: e.y, z: e.z }, e.mag); audio?.playPunch?.(Math.min(1, e.mag / 20)); }));
  offs.push(on('ko', e => { fx?.koAt?.({ x: e.x, y: e.y, z: e.z }, e.kind); audio?.playKO?.(); announce?.(e); }));
  offs.push(on('splash', e => { fx?.splash?.({ x: e.x, y: e.y, z: e.z }); audio?.playSplash?.(); }));
  offs.push(on('explosion', e => { fx?.explosionAt?.({ x: e.x, y: e.y, z: e.z }, e.mag); }));
  offs.push(on('powerup', e => { hud?.popup?.('POWER!', { x: e.x, y: e.y, z: e.z }, 'small', 0xffd23f); }));
  offs.push(on('go', () => { hud?.announce?.('GO!', 'go', 0.8); }));
  offs.push(on('countdown', e => { hud?.announce?.(String(e.mag), 'count', 0.6); }));
  offs.push(on('suddenDeath', () => { hud?.setSuddenDeath?.('SUDDEN DEATH'); }));
  offs.push(on('roundEnd', e => { hud?.announce?.('ROUND ' + e.mag, 'round', 1.2); }));
  offs.push(on('matchEnd', () => { hud?.announce?.('MATCH!', 'match', 1.5); }));
  return () => { for (const off of offs) off(); };
}
export function createViewBus() { return new EventBus(); }
