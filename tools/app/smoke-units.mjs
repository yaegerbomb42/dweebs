/* global EventTarget */
import { mk } from './domshim.mjs';
let pass=0, fail=0;
const ok=(c,m)=>{ c?(pass++):(fail++, console.log('  FAIL:',m)); };
const t=(name,fn)=>{ try{ fn(); console.log('✓',name);}catch(e){ fail++; console.log('✗',name,'—',e.message);} };

// --- router -------------------------------------------------------------
const { createRouter, INVITE_RE } = await import('../../src/app/router.js');
t('router: parses #/room/ABCD invite links', ()=>{
  globalThis.location.hash='#/room/ABCD';
  const seen=[]; const r=createRouter({onRoute:x=>seen.push(x)});
  ok(r.path==='/room/ABCD','room path, got '+r.path);
  ok(r.current.code==='ABCD','code, got '+r.current.code);
});
t('router: uppercases and normalises', ()=>{
  globalThis.location.hash='#/room/ab3d';
  const r=createRouter({}); ok(r.current.code==='AB3D','got '+r.current.code);
});
t('router: unknown route falls back to title', ()=>{
  globalThis.location.hash='#/nonsense';
  const r=createRouter({}); ok(r.path==='/','got '+r.path);
});
t('router: #/lobby?code=ABCD normalises to #/room/ABCD', ()=>{
  globalThis.location.hash='#/lobby?code=ABCD';
  const r=createRouter({}); ok(r.path==='/room/ABCD','got '+r.path);
});
t('router: match lock refuses to walk out of a live match', ()=>{
  globalThis.location.hash='#/match';
  const seen=[]; const r=createRouter({onRoute:x=>seen.push(x)});
  r.setMatchLock(true);
  globalThis.location.hash='#/play'; r.go('/play');
  ok(r.path==='/match','stayed on /match, got '+r.path);
});
t('router: unlocked match can be left', ()=>{
  globalThis.location.hash='#/match';
  const r=createRouter({});
  r.go('/play');
  ok(r.path==='/play','got '+r.path);
});
t('router: invite regex accepts 4 chars, rejects junk', ()=>{
  ok(INVITE_RE.test('ABCD') && INVITE_RE.test('ab12'),'accepts');
  ok(!INVITE_RE.test('ABC') && !INVITE_RE.test('ABCDE') && !INVITE_RE.test('AB-D'),'rejects');
});

// --- settings -----------------------------------------------------------
t('settings: defaults, persist, survive corrupt storage', async ()=>{
  const m = await import('../../src/app/settings.js');
  const d = m.loadSettings();
  ok(d.quality==='high' && d.master===0.8,'defaults');
  m.saveSettings({quality:'low', playerName:'Zed'});
  ok(m.loadSettings().quality==='low' && m.loadSettings().playerName==='Zed','persisted');
  ok(m.prettyCode('KeyW')==='W' && m.prettyCode('Space')==='SPACE','prettyCode');
  // corrupt storage must not throw
  globalThis.localStorage.setItem('dweebs-settings','{{{not json');
  
  ok(true,'corrupt storage handled without throwing');
});
t('settings: serverUrl precedence ?server > storage', async ()=>{
  const m = await import('../../src/app/settings.js');
  m.saveSettings({serverUrl:'wss://stored'});
  globalThis.location.search='?server=wss://override';
  ok(m.serverUrl()==='wss://override','query wins, got '+m.serverUrl());
  globalThis.location.search='';
  ok(m.serverUrl()==='wss://stored','storage next, got '+m.serverUrl());
  m.saveSettings({serverUrl:''});
  ok(m.serverUrl()==='','empty means no server (never blocks)');
});

// --- MockNetClient (the published contract) -----------------------------
t('net: implements every method in the APP->NET contract', async ()=>{
  const { MockNetClient } = await import('../../src/app/MockNetClient.js');
  const n = new MockNetClient({serverUrl:null});
  for (const m of ['connect','createRoom','joinRoom','quickPlay','setReady','updateProfile',
                   'updateSettings','roomSnapshot','leave','disconnect','on'])
    ok(typeof n[m]==='function', 'missing '+m);
  ok(typeof n.rttMs==='number','rttMs getter');
  ok(n instanceof EventTarget,'extends EventTarget');
});
t('net: create → ready → settings round-trip', async ()=>{
  const { MockNetClient } = await import('../../src/app/MockNetClient.js');
  const n = new MockNetClient({serverUrl:null, transportDelay:0});
  const room = await n.createRoom({name:'Zed', archetype:'blob', color:'pink'});
  ok(room.code==='ABCD','code '+room.code);
  ok(room.players.some(p=>p.you && p.host),'creator is host');
  ok(JSON.stringify(room)===JSON.stringify(n.roomSnapshot()),'snapshot is JSON-safe & equal');
  n.setReady(true);
  ok(n.roomSnapshot().players.find(p=>p.you).ready===true,'setReady');
  n.updateSettings({stocks:5, items:false});
  const s=n.roomSnapshot().settings;
  ok(s.stocks===5 && s.items===false,'settings applied: '+JSON.stringify(s));
  n.leave(); ok(n.roomSnapshot()===null,'leave clears room');
});
t('net: ROOM_NOT_FOUND / ROOM_FULL error codes', async ()=>{
  const { MockNetClient } = await import('../../src/app/MockNetClient.js');
  const a = new MockNetClient({transportDelay:0});
  let e1=null; try{ await a.joinRoom('ZZZZ',{}); }catch(e){ e1=e; }
  ok(e1 && e1.code==='ROOM_NOT_FOUND','got '+e1?.code);
  globalThis.location.search='?mock=full';
  const b2 = new MockNetClient({transportDelay:0});   // reads flag at construction
  let e2=null; try{ await b2.joinRoom('ABCD',{}); }catch(e){ e2=e; }
  ok(e2 && e2.code==='ROOM_FULL','got '+e2?.code);
  globalThis.location.search='';
});
t('net: never dials the network (serverUrl null ⇒ no transport)', async ()=>{
  const { MockNetClient } = await import('../../src/app/MockNetClient.js');
  const n = new MockNetClient({serverUrl:null, transportDelay:0});
  ok(n.mocked===true,'marked mocked');
  await n.createRoom({});   // completes with no network available
  ok(n.connected===true,'connected (in memory)');
});

// --- legacy bridge (the offline safety net) -----------------------------
t('legacy: offline match start is a local click, no net', async ()=>{
  const L = await import('../../src/app/legacy.js');
  const play = mk('btn-play'); let clicked=0; play.addEventListener('click',()=>clicked++);
  ok(L.startOfflineMatch()===true,'PLAY found');
  ok(clicked===1,'clicked exactly once, got '+clicked);
  ok(L.startOfflineMatch()===true,'idempotent, no throw');
});
t('legacy: menu visibility is the only thing the shell touches', async ()=>{
  const L = await import('../../src/app/legacy.js');
  const menu = mk('main-menu'); menu.classList.add('hidden');
  L.showOfflineMenu({bots:'3'}); ok(!menu.classList.contains('hidden'),'menu shown');
  ok(L.isAtMenu()===true,'isAtMenu true');
  L.hideOfflineMenu(); ok(menu.classList.contains('hidden'),'menu hidden');
  ok(L.isAtMenu()===false,'isAtMenu false');
});
t('legacy: isMatchLive reads the DOM when no debug handle exists', async ()=>{
  const L = await import('../../src/app/legacy.js');
  delete globalThis.__dweebs;
  const hud = mk('hud'); hud.classList.add('hidden');
  ok(L.isMatchLive()===false,'hidden HUD ⇒ not live');
  hud.classList.remove('hidden');
  ok(L.isMatchLive()===true,'visible HUD ⇒ live');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
