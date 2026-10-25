/* global URLSearchParams, queueMicrotask */
// Minimal DOM shim: just enough to exercise the app shell's pure logic in Node.
class El {
  constructor(tag='div'){ this.tagName=tag.toUpperCase(); this.children=[]; this.attrs={};
    this.style={}; this.dataset={}; this._classes=new Set(); this._text=''; this._html='';
    this.parentNode=null; this.listeners={}; this.disabled=false; }
  get classList(){ const s=this._classes; return {
    add:(...c)=>c.forEach(x=>s.add(x)), remove:(...c)=>c.forEach(x=>s.delete(x)),
    contains:c=>s.has(c), toggle:(c,f)=>{ if(f===undefined){s.has(c)?s.delete(c):s.add(c);} else if(f)s.add(c); else s.delete(c); } }; }
  get className(){ return [...this._classes].join(' '); }
  set className(v){ this._classes=new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent(){ return this._text; }
  set textContent(v){ this._text=String(v); this.children=[]; }
  set innerHTML(v){ this._html=v; this.children=[]; }
  get innerHTML(){ return this._html; }
  append(...n){ for(const c of n){ if(c.parentNode)c.parentNode.removeChild(c); c.parentNode=this; this.children.push(c);} }
  appendChild(c){ this.append(c); return c; }
  removeChild(c){ const i=this.children.indexOf(c); if(i>=0)this.children.splice(i,1); c.parentNode=null; return c; }
  remove(){ this.parentNode?.removeChild(this); }
  setAttribute(k,v){ this.attrs[k]=v; if(k==='id') this.id=v; }
  getAttribute(k){ return this.attrs[k] ?? null; }
  addEventListener(t,f){ (this.listeners[t] ||= []).push(f); }
  removeEventListener(t,f){ const l=this.listeners[t]||[]; const i=l.indexOf(f); if(i>=0)l.splice(i,1); }
  click(){ for(const f of this.listeners.click||[]) f({type:'click',target:this,preventDefault(){},stopPropagation(){}}); }
  focus(){}
  querySelector(){ return null; }
  querySelectorAll(){ return []; }
  closest(){ return null; }
}
const registry = new Map();
function mk(id, tag='div'){ const e=new El(tag); e.id=id; registry.set(id,e); return e; }
globalThis.__El = El;
globalThis.document = {
  createElement: t => new El(t),
  createElementNS: (ns,t) => new El(t),
  createTextNode: t => { const e=new El('#text'); e.textContent=t; return e; },
  getElementById: id => registry.get(id) || null,
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener(){}, removeEventListener(){},
  body: new El('body'),
  documentElement: new El('html'),
  hidden: false,
};
globalThis.window = globalThis;
const winHandlers = new Map();
globalThis.addEventListener = (t,f)=>{ (winHandlers.get(t) ?? winHandlers.set(t,[]).get(t)).push(f); };
globalThis.removeEventListener = (t,f)=>{ const l=winHandlers.get(t)||[]; const i=l.indexOf(f); if(i>=0)l.splice(i,1); };
globalThis.dispatchEvent = e=>{ for(const f of winHandlers.get(e.type)||[]) f(e); return true; };
globalThis.location = { hash:'', origin:'http://x', pathname:'/', search:'', reload(){} };
globalThis.history = { _s:null, pushState(s,t,u){ this._s=u; globalThis.location.hash=u; },
  replaceState(s,t,u){ this._s=u; globalThis.location.hash=u; }, back(){} };
Object.defineProperty(globalThis,'navigator',{value:{getGamepads:()=>[]},configurable:true,writable:true});
globalThis.localStorage = { _m:new Map(), getItem(k){ return this._m.has(k)?this._m.get(k):null; },
  setItem(k,v){ this._m.set(k,String(v)); }, removeItem(k){ this._m.delete(k); } };
globalThis.CustomEvent = class { constructor(t,o){ this.type=t; this.detail=o?.detail; } };
globalThis.EventTarget = class { constructor(){ this._h=new Map(); }
  addEventListener(t,f){ (this._h.get(t) ?? this._h.set(t,[]).get(t)).push(f); }
  removeEventListener(t,f){ const l=this._h.get(t)||[]; const i=l.indexOf(f); if(i>=0)l.splice(i,1); }
  dispatchEvent(e){ for(const f of this._h.get(e.type)||[]) f(e); } };
globalThis.URLSearchParams = URLSearchParams;
globalThis.queueMicrotask = queueMicrotask;
globalThis.MutationObserver = class { observe(){} disconnect(){} };
export { El, mk, registry };
