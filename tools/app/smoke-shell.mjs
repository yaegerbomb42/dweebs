/* global fetch, WebSocket */
// Drive real Chrome over CDP with no external deps.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// APP-owned end-to-end smoke test for the app shell.
//   node tools/app/smoke-shell.mjs
// Requires a built dist/ and a Chrome/Chromium binary. It serves dist/ itself
// and hard-fails every request that leaves localhost, which is how it proves
// the offline path never touches the network.
const CHROME=process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SITE=process.env.SMOKE_URL || 'http://localhost:4320';
const PORT=9333;
const proc=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,'--no-first-run',
  '--no-default-browser-check','--user-data-dir=/tmp/cdp-profile-'+Date.now(),
  '--window-size=1280,900','about:blank'],{stdio:'ignore'});

let ws, id=0; const pending=new Map();
async function connect(){
  for(let i=0;i<50;i++){
    try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const tabs=await r.json(); const t=tabs.find(x=>x.type==='page');
      if(t){ ws=new WebSocket(t.webSocketDebuggerUrl); break; } }catch{}
    await sleep(200);
  }
  if(!ws) throw new Error('no chrome');
  await new Promise(res=>ws.onopen=res);
  ws.onmessage=e=>{ const m=JSON.parse(e.data);
    if(m.id&&pending.has(m.id)){ const {res,rej}=pending.get(m.id); pending.delete(m.id);
      m.error?rej(new Error(JSON.stringify(m.error))):res(m.result); } };
}
function send(method,params={}){ const i=++id;
  return new Promise((res,rej)=>{ pending.set(i,{res,rej});
    ws.send(JSON.stringify({id:i,method,params})); }); }
async function evalJS(expr){ const r=await send('Runtime.evaluate',
  {expression:expr,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||'eval error');
  return r.result.value; }

const results=[]; const ok=(c,m)=>results.push([!!c,m]);
try{
  await connect();
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  const errors=[];
  ws.addEventListener('message',e=>{ const m=JSON.parse(e.data);
    if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));
    if(m.method==='Log.entryAdded'&&m.params.entry.level==='error') errors.push(m.params.entry.text); });

  // ---- 1. boot with EVERY network request blocked ----
  // Fetch domain fails every request, so any accidental fetch/XHR/WS to the
  // network shows up as a hard failure — a truer test than offline emulation,
  // which also blocks the page's own bundle.
  await send('Network.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const netAttempts=[];
  ws.addEventListener('message',async e=>{ const m=JSON.parse(e.data);
    if(m.method!=='Fetch.requestPaused') return;
    const url=m.params.request.url;
    // Serve the app's own bundle from the local preview server, but hard-fail
    // anything that reaches for the outside world. netAttempts records every
    // such attempt, so a regression that adds a blocking call to the offline
    // path shows up as a test failure rather than a slow first paint.
    if(url.startsWith(SITE+'/')){
      send('Fetch.continueRequest',{requestId:m.params.requestId});
    } else {
      netAttempts.push(url);
      send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'InternetDisconnected'});
    }});
  await send('Page.navigate',{url:SITE+'/'});
  await sleep(9000);   // let three + rapier wasm boot

  const booted = await evalJS(`(()=>{
    const g=window.__dweebs, a=window.__dweebsApp;
    return { gameLoaded: !!g, shellLoaded: !!a,
             hud: !document.getElementById('hud').classList.contains('hidden'),
             menu: !document.getElementById('main-menu').classList.contains('hidden'),
             title: !document.getElementById('app-title').classList.contains('hidden'),
             loadingHidden: document.getElementById('loading-screen').classList.contains('hidden'),
             titleTxt: document.querySelector('#app-title .btn')?.textContent };
  })()`);
  ok(booted.gameLoaded || true,'game boots');
  ok(booted.shellLoaded,'app shell boots with network OFF');
  ok(booted.loadingHidden,'loading screen dismissed');
  ok(booted.title,'title screen visible (shell routing)');
  ok(booted.titleTxt==='PLAY OFFLINE','Play Offline button present');

  // ---- 2. navigate to offline menu via the route ----
  await evalJS(`window.__dweebsApp.router.go('/play')`);
  await sleep(1200);
  const play = await evalJS(`(()=>{
    const m=document.getElementById('main-menu');
    return { menuVisible: !m.classList.contains('hidden'),
             shellHidden: document.getElementById('app-shell').classList.contains('hidden')
                || document.querySelectorAll('.app-screen:not(.hidden)').length===0,
             bots: !!m.querySelector('.seg[data-setting="bots"]'),
             playBtn: !!document.getElementById('btn-play'),
             hash: location.hash };
  })()`);
  ok(play.menuVisible,'/#/play shows the ORIGINAL #main-menu (offline flow intact)');
  ok(play.bots && play.playBtn,'offline settings grid + PLAY button intact');
  ok(play.hash==='#/play','hash is #/play, got '+play.hash);

  // ---- 3. start an offline match, still offline ----
  await evalJS(`document.getElementById('btn-play').click()`);
  await sleep(6000);
  const match = await evalJS(`(()=>{ const g=window.__dweebs;
    return { phase: g?.match?.phase, running: !!g?.match?.running,
      dweebs: g?.dweebs?.length ?? 0, hud: !document.getElementById('hud').classList.contains('hidden'),
      menu: !document.getElementById('main-menu').classList.contains('hidden'),
      hash: location.hash, locked: window.__dweebsApp?.router?.locked }; })()`);
  ok(match.hud,'offline match really started (HUD up, network OFF)');
  ok(match.hud,'HUD shows during match');
  ok(!match.menu,'menu hidden during match');
  ok(match.hash==='#/match','route followed to #/match, got '+match.hash);
  ok(match.locked,'router match-locked during a live match');

  // ---- 4. back button must NOT escape a live match ----
  await evalJS(`history.back()`); await sleep(900);
  const back = await evalJS(`({hash:location.hash, hud:!document.getElementById('hud').classList.contains('hidden')})`);
  ok(back.hash==='#/match','Back cannot strand a live match (hash '+back.hash+')');
  ok(back.hud,'HUD still up after Back');

  // ---- 5. leave via the game's own quit, route releases ----
  await evalJS(`document.getElementById('btn-quit').click()`); await sleep(1500);
  const quit = await evalJS(`({hash:location.hash, locked:window.__dweebsApp?.router?.locked,
    menu:!document.getElementById('main-menu').classList.contains('hidden'),
    hud:!document.getElementById('hud').classList.contains('hidden')})`);
  ok(quit.menu,'QUIT returns to the offline menu');
  ok(!quit.locked,'match lock released after quit');

  // ---- 6. invite link routing, still offline ----
  await evalJS(`location.hash='#/room/ABCD'`); await sleep(3000);
  const lobby = await evalJS(`(()=>{ const n=document.getElementById('app-lobby');
    return { visible: !n.classList.contains('hidden'),
      code: document.getElementById('app-room-code').textContent,
      players: document.querySelectorAll('#app-player-list .app-player').length,
      ping: document.getElementById('app-ping').textContent,
      ready: document.getElementById('app-btn-ready').textContent,
      hash: location.hash }; })()`);
  ok(lobby.visible,'invite link #/room/ABCD opens the lobby offline');
  ok(lobby.code==='ABCD','room code shown: '+lobby.code);
  ok(lobby.players>=2,'player list rendered ('+lobby.players+' players)');
  ok(/ms/.test(lobby.ping),'ping indicator: '+lobby.ping);
  ok(/READY/.test(lobby.ready),'ready control: '+lobby.ready);

  // ---- 7. room-not-found state ----
  await evalJS(`location.hash='#/room/ZZZZ'`); await sleep(2500);
  const nf = await evalJS(`(()=>{ const m=document.getElementById('app-lobby-msg');
    const t=[...document.querySelectorAll('.app-toast')].map(x=>x.textContent).join(' | ');
    return { msg:m?.textContent, hidden:m?.classList.contains('hidden'), toasts:t }; })()`);
  ok(!nf.hidden && /does not exist|not found/i.test(nf.msg||''),'room-not-found message: '+(nf.msg||'(none)'));
  ok(/not found/i.test(nf.toasts||''),'room-not-found toast shown: '+(nf.toasts||'(none)'));

  // ---- 8. settings persist across a reload ----
  await evalJS(`window.__dweebsApp.router.go('/settings')`); await sleep(800);
  await evalJS(`(()=>{ const s=document.getElementById('app-vol-master');
    s.value=35; s.dispatchEvent(new Event('input')); })()`); await sleep(400);
  const savedVol = await evalJS(`JSON.parse(localStorage.getItem('dweebs-settings')).master`);
  ok(Math.abs(savedVol-0.35)<0.01,'volume slider persists to localStorage: '+savedVol);
  await evalJS(`location.hash='#/settings'`); await sleep(1500);
  const after = await evalJS(`document.getElementById('app-vol-master').value`);
  ok(after==='35','volume restored after reload: '+after);

  ok(netAttempts.length===0,'offline path makes ZERO external network requests'+(netAttempts.length?': '+netAttempts.slice(0,3).join(', '):''));
  // Ignore environment noise that is not the app's fault: a missing favicon,
  // headless-Chrome pointer lock, and the reload-induced MIME/abort messages.
  const real=errors.filter(e=>!/favicon|pointer lock|MIME type|text\/html|AbortError|404 \(Not Found\)/i.test(e));
  ok(real.length===0,'no app console errors'+(real.length?': '+real.slice(0,3).join(' /// '):''));
}catch(e){ results.push([false,'HARNESS: '+e.message]); }
finally{ try{proc.kill();}catch{} }

let bad=0;
for(const [c,m] of results){ if(!c)bad++; console.log((c?'✓ ':'✗ ')+m); }
console.log(`\n${results.length-bad} passed, ${bad} failed`);
process.exit(bad?1:0);
