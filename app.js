'use strict';
const $ = s => document.querySelector(s);
const ALLERGENS = {
  peanuts:{label:'Peanuts',emoji:'🥜',tags:['en:peanuts'],kw:['peanut','groundnut','arachis']},
  treenuts:{label:'Tree Nuts',emoji:'🌰',tags:['en:nuts'],kw:['almond','hazelnut','walnut','cashew','pistachio','pecan','macadamia','brazil nut','nut']},
  milk:{label:'Milk / Dairy',emoji:'🥛',tags:['en:milk'],kw:['milk','butter','cheese','cream','whey','casein','lactose','yogurt','yoghurt','ghee']},
  eggs:{label:'Eggs',emoji:'🥚',tags:['en:eggs'],kw:['egg','albumen','mayonnaise']},
  gluten:{label:'Wheat / Gluten',emoji:'🌾',tags:['en:gluten'],kw:['wheat','gluten','barley','rye','semolina','spelt','malt','flour']},
  soy:{label:'Soy',emoji:'🫘',tags:['en:soybeans'],kw:['soy','soya','tofu','edamame','lecithin (soy']},
  fish:{label:'Fish',emoji:'🐟',tags:['en:fish'],kw:['fish','anchov','salmon','tuna','cod','sardine']},
  shellfish:{label:'Shellfish',emoji:'🦐',tags:['en:crustaceans','en:molluscs'],kw:['shrimp','prawn','crab','lobster','krill','mussel','oyster','squid','clam']}
};
const store = {
  get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},
  set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
};
let profile = store.get('sb_profile',[]);
let strict = store.get('sb_strict',true);
let recents = store.get('sb_recents',[]);
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- Safety engine ---------- */
function evaluate(p){
  const tags = p.allergens_tags||[], traces = p.traces_tags||[];
  const text = (p.ingredients_text||'').toLowerCase();
  const contains=[], maybe=[], textHits=[];
  for(const id of profile){
    const a = ALLERGENS[id]; if(!a) continue;
    if(a.tags.some(t=>tags.includes(t))) contains.push(a.label);
    else if(a.tags.some(t=>traces.includes(t))) maybe.push(a.label);
    else if(text && a.kw.some(k=>new RegExp('\\b'+k.replace(/[()]/g,'\\$&'),'i').test(text))) textHits.push(a.label);
  }
  const danger=[...new Set([...contains,...textHits])];
  if(danger.length) return {s:'danger',list:danger,fromText:contains.length===0};
  if(strict && maybe.length) return {s:'warn',list:maybe};
  if(!text && !tags.length) return {s:'unk',list:[]};
  return {s:'safe',list:[],note:maybe.length?maybe:null};
}
function highlight(text,hits){
  let out = esc(text);
  const kws = profile.flatMap(id=>ALLERGENS[id]?.kw||[]).filter(k=>!k.includes('('));
  if(kws.length) out = out.replace(new RegExp('\\b('+kws.join('|')+')\\w*','gi'),'<mark>$&</mark>');
  return out;
}

/* ---------- Fetch ---------- */
const FIELDS='code,product_name,brands,image_front_small_url,ingredients_text,allergens_tags,traces_tags';
async function fetchJSON(url){
  const r = await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status); return r.json();
}
async function search(term){
  term = term.trim(); if(!term) return;
  if(!profile.length) toast('Tip: set your allergy profile first');
  setStatus('<span class="spin"></span>Checking ingredients…'); $('#results').innerHTML='';
  addRecent(term);
  try{
    let products;
    if(/^\d{8,14}$/.test(term)){
      const d = await fetchJSON(`https://world.openfoodfacts.org/api/v2/product/${term}.json?fields=${FIELDS}`);
      products = d.product ? [d.product] : [];
    } else {
      const d = await fetchJSON(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=15&fields=${FIELDS}`);
      products = (d.products||[]).filter(p=>p.product_name);
    }
    render(products,term);
  }catch(e){
    setStatus(''); $('#results').innerHTML = emptyState('Can’t reach the food database','Check your connection and try again.');
  }
}

/* ---------- Render ---------- */
const ICON = {danger:'⚠️',safe:'✅',warn:'🟠',unk:'❔'};
function render(products,term){
  if(!products.length){ setStatus(''); $('#results').innerHTML = emptyState('No products found for “'+esc(term)+'”','Try a simpler name, a brand, or scan the barcode.'); return; }
  const order={danger:0,warn:1,unk:2,safe:3};
  const rows = products.map(p=>({p,v:evaluate(p)}));
  const nSafe = rows.filter(r=>r.v.s==='safe').length;
  setStatus(`${rows.length} results · ${nSafe} safe for you`);
  $('#results').innerHTML = rows.map(({p,v},i)=>{
    const msg = {
      danger:[`CONTAINS: ${v.list.join(', ')}`, v.fromText?'Found in ingredient text — verify on pack':'Listed in allergen data'],
      warn:[`MAY CONTAIN: ${v.list.join(', ')}`,'Possible cross-contamination'],
      safe:['Safe based on your profile', v.note?`Traces possible: ${v.note.join(', ')}`:(profile.length?'No match in listed allergens':'Set your profile for a real check')],
      unk:['Not enough data','No ingredient info on file. Check the pack.']
    }[v.s];
    const ing = p.ingredients_text ? highlight(p.ingredients_text) : 'No ingredients listed for this product.';
    const tags = (p.allergens_tags||[]).map(t=>t.replace(/^\w\w:/,'')).map(t=>`<span class="${profile.some(id=>ALLERGENS[id].tags.includes('en:'+t))?'hit':''}">${esc(t)}</span>`).join('');
    return `<article class="card ${v.s}" style="animation-delay:${Math.min(i,8)*55}ms">
      <div class="info">${p.image_front_small_url?`<img src="${esc(p.image_front_small_url)}" alt="" loading="lazy">`:'<div class="ph">🍽️</div>'}
      <div><p class="brandn">${esc((p.brands||'Unknown brand').split(',')[0])}</p><h2 class="name">${esc(p.product_name)}</h2></div></div>
      <div class="verdict"><span class="ic" aria-hidden="true">${ICON[v.s]}</span><div>${esc(msg[0])}<small>${esc(msg[1])}</small></div></div>
      ${tags?`<div class="tags" style="padding-top:12px">${tags}</div>`:''}
      <details><summary>View Full Ingredients</summary><p>${ing}</p></details></article>`;
  }).join('');
  if(rows.some(r=>r.v.s==='danger') && navigator.vibrate) navigator.vibrate(40);
}
function emptyState(h,p){
  return `<div class="empty"><svg viewBox="0 0 200 150" aria-hidden="true"><ellipse cx="100" cy="132" rx="62" ry="8" fill="#F2F4F8"/><circle cx="100" cy="70" r="52" fill="#F6F8FB" stroke="#0E1726" stroke-width="4"/><circle cx="84" cy="62" r="5" fill="#0E1726"/><circle cx="116" cy="62" r="5" fill="#0E1726"/><path d="M82 92q18-14 36 0" stroke="#E5173F" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M146 30l22-22M158 42l24-6" stroke="#19D98B" stroke-width="5" stroke-linecap="round"/></svg><h3>${h}</h3><p>${p}</p></div>`;
}
const setStatus = h => $('#status').innerHTML = h;
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2600)}

/* ---------- Profile ---------- */
function renderBanner(){
  const b=document.querySelector('.banner');
  const names = profile.map(id=>ALLERGENS[id]?.label.split(' / ')[0]);
  $('#bannerText').textContent = names.length ? 'Filtering out: '+names.join(', ') : 'No allergies set — tap Edit Profile';
  b.classList.toggle('empty',!names.length);
}
function openProfile(){
  const wrap=$('#toggles'); wrap.innerHTML='';
  Object.entries(ALLERGENS).forEach(([id,a])=>{
    const b=document.createElement('button'); b.type='button'; b.className='tg';
    b.setAttribute('aria-pressed',profile.includes(id)); b.dataset.id=id;
    b.innerHTML=`<span class="e">${a.emoji}</span>${a.label}`;
    b.onclick=()=>b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')!=='true');
    wrap.appendChild(b);
  });
  $('#strictTraces').checked=strict; $('#profileDlg').showModal();
}
$('#profileForm').addEventListener('submit',()=>{
  profile=[...document.querySelectorAll('.tg[aria-pressed=true]')].map(b=>b.dataset.id);
  strict=$('#strictTraces').checked; store.set('sb_profile',profile); store.set('sb_strict',strict);
  renderBanner(); toast('Profile saved'); const q=$('#q').value; if(q.trim()) search(q);
});
$('#editBtn').onclick=openProfile;

/* ---------- Search & recents ---------- */
function addRecent(t){ if(/^\d+$/.test(t))return; recents=[t,...recents.filter(r=>r.toLowerCase()!==t.toLowerCase())].slice(0,4); store.set('sb_recents',recents); renderRecents(); }
function renderRecents(){
  $('#recents').innerHTML = recents.map(r=>`<button type="button">${esc(r)}</button>`).join('');
  $('#recents').querySelectorAll('button').forEach(b=>b.onclick=()=>{$('#q').value=b.textContent;search(b.textContent)});
}
$('#searchForm').addEventListener('submit',e=>{e.preventDefault();$('#q').blur();search($('#q').value)});

/* ---------- Optional barcode scan ---------- */
let stream,scanTimer;
if('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia) $('#scanBtn').hidden=false;
$('#scanBtn').onclick=async()=>{
  try{
    const det=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e']});
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    const v=$('#video'); v.srcObject=stream; await v.play(); $('#scanDlg').showModal();
    scanTimer=setInterval(async()=>{
      try{const c=await det.detect(v); if(c[0]){stopScan();$('#q').value=c[0].rawValue;search(c[0].rawValue)}}catch{}
    },350);
  }catch{ toast('Camera unavailable — type the name or barcode instead'); }
};
function stopScan(){clearInterval(scanTimer);stream?.getTracks().forEach(t=>t.stop());$('#scanDlg').close()}
$('#scanClose').onclick=stopScan;

/* ---------- PWA, install, share ---------- */
let deferred;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('#installBtn').hidden=false});
window.addEventListener('appinstalled',()=>{$('#installBtn').hidden=true;toast('SafeBite installed')});
$('#installBtn').onclick=async()=>{ if(!deferred)return; deferred.prompt(); await deferred.userChoice; deferred=null; $('#installBtn').hidden=true; };
if(/iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone){ $('#installBtn').hidden=false; $('#installBtn').onclick=()=>toast('Tap Share, then “Add to Home Screen”'); }
$('#shareBtn').onclick=async()=>{
  const d={title:'SafeBite',text:'Check any food against your allergies in seconds.',url:'https://safebite.suvadipchakraborty.workers.dev/'};
  try{ if(navigator.share) await navigator.share(d); else {await navigator.clipboard.writeText(d.url); toast('Link copied');} }catch{}
};
if('serviceWorker' in navigator) addEventListener('load',()=>navigator.serviceWorker.register('sw.js'));

renderBanner(); renderRecents();
if(!store.get('sb_seen',false)){ store.set('sb_seen',true); setTimeout(openProfile,400); }
