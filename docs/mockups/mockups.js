const assets = '../../public/assets/';
const symbols = { red:'●', blue:'■', green:'▲', yellow:'◆' };
const colorNames = { red:'Rot', blue:'Blau', green:'Grün', yellow:'Gelb' };
const colors = Object.keys(symbols);
const number = (value,color='red') => ({ value,color,asset:`card-${color}-${String(value).padStart(2,'0')}.svg` });
const wild = { value:null,color:'special',asset:'card-wild.svg' };
const set = value => ({ kind:'set',value,label:`3 × ${value}`,cards:colors.slice(0,3).map(color=>number(value,color)) });
const run = (start,length) => ({ kind:'run',start,label:`Folge ${start}–${start+length-1}`,cards:Array.from({length},(_,i)=>number(start+i,colors[i%4])) });
const players = [
  { name:'Du',phase:1,left:4,groups:[set(7),set(9)] },
  { name:'Bot 1',phase:2,left:3,groups:[set(5),run(4,4)] },
  { name:'Bot 2',phase:4,left:2,groups:[run(1,7)] },
  { name:'Bot 3',phase:7,left:2,groups:[{...set(7),label:'4 × 7',cards:[...set(7).cards,number(7,'yellow')]},{...set(10),label:'4 × 10',cards:[...set(10).cards,number(10,'yellow')]}] },
  { name:'Bot 4',phase:8,left:3,groups:[{kind:'color',color:'blue',label:'7 × Blau',cards:Array.from({length:7},(_,i)=>number(i+2,'blue'))}] },
  { name:'Bot 5',phase:1,left:4,groups:[set(2),set(4)] },
];
const initialHand = [number(7,'red'),number(9,'green'),number(11,'yellow'),wild];
const concepts = [
  { id:'a',title:'A · Feste Spielzonen',recommended:true,copy:'Stapel oben, kompakte Hand unten. Mehr Platz für die ausgelegten Phasen dazwischen.',note:'<strong>Kleinerer Handbereich, mehr Tisch.</strong> Handkarten bleiben kompakt, Zahlen lesbar und die Abwerfen-Taste gut erreichbar.' },
  { id:'b',title:'B · Alles beim Daumen',copy:'Stapel, Hand und Abwerfen sitzen zusammen unten. Oben bleibt Platz für den Tisch.',note:'<strong>Kurze Wege für den Finger.</strong> Gut für Bedienung mit einer Hand; die feste untere Zone braucht etwas mehr Höhe.' },
  { id:'c',title:'C · Spieler-Tabs',copy:'Eine ausgelegte Phase im Fokus. Zwischen Spielern wechseln statt lange Listen scrollen.',note:'<strong>Größere Karten, weniger Scrollen.</strong> Dafür wechselst du die Ansicht, um die Phasen anderer Spieler zu vergleichen.' },
];
function cardMarkup(card,hand=false,index=0,selected=false) {
  const label=card.value===null?'Joker':`${card.value} ${colorNames[card.color]}`;
  const content=`<img src="${assets+card.asset}" alt="${label}" draggable="false"><span class="corner" aria-hidden="true">${card.value??'✦'}${card.value===null?'':`<small>${symbols[card.color]}</small>`}</span>`;
  return hand ? `<button class="card" data-color="${card.color}" data-card="${index}" aria-label="${label} auswählen" aria-pressed="${selected}">${content}</button>` : `<div class="card" data-color="${card.color}">${content}</div>`;
}
function piles() { return `<div class="piles"><button class="pile pile-button" data-pile="stock" aria-label="Nachziehstapel im Beispiel" disabled><img src="${assets}card-back.svg" alt="Verdeckter Nachziehstapel"><span>Nachziehen<strong>43 Karten</strong></span></button><button class="pile pile-button" data-pile="discard" aria-label="Ablagestapel: 6 Blau" disabled><img src="${assets}card-blue-06.svg" alt="6 Blau"><span>Ablage<strong>6 Blau</strong></span></button></div>`; }
function matches(group,cards) {
  if (!cards.length) return false;
  if(group.kind==='set') return cards.every(c=>c.value===null||c.value===group.value);
  if(group.kind==='color') return cards.every(c=>c.value===null||c.color===group.color);
  const start=group.start, end=start+group.cards.length-1;
  const natural=cards.filter(c=>c.value!==null).map(c=>c.value);
  if(new Set(natural).size!==natural.length||natural.some(v=>v>=start&&v<=end)) return false;
  for(let left=0;left<=cards.length;left++) {
    const low=start-left, high=end+cards.length-left;
    if(low<1||high>12) continue;
    if(natural.every(v=>v>=low&&v<=high)) return true;
  }
  return false;
}
function phoneMarkup(concept) {
  return `<article class="concept"><div class="concept-heading"><h2>${concept.title}</h2>${concept.recommended?'<span class="recommend">Meine Empfehlung</span>':''}</div><p class="concept-copy">${concept.copy}</p><div class="phone ${concept.id}" data-concept="${concept.id}"><div class="screen"><div class="status-bar" aria-hidden="true"><span>9:41</span><span>▮▮▮ ▰</span></div><div class="app-header"><span class="wordmark">PHASE<span>10</span></span><span class="round">RUNDE 6</span></div><div class="phase-line"><strong>Deine Phase 1 · Zwei Drillinge</strong><span>✓ Ausgelegt</span></div><div class="turn-line"><h3>Du bist am Zug.</h3><span class="turn-chip">✓ Gezogen · Jetzt spielen</span></div>${concept.id==='a'?piles():''}${concept.id==='c'?'<div class="player-tabs" role="tablist" aria-label="Ausgelegte Phasen nach Spieler"></div>':''}<div class="table-pane"${concept.id==='c'?' role="tabpanel"':''} tabindex="0" aria-label="Ausgelegte Phasen, scrollbar"></div><div class="control-dock">${concept.id!=='a'?piles():''}<div class="hand-title"><span>Deine Hand</span><small>4 Karten</small></div><div class="hand"></div><div class="hand-tools"><span class="selection" role="status"></span><button class="order-button" data-order>Beispiel zurücksetzen</button></div><button class="discard" data-discard></button><p class="toast" role="status"></p><div class="home-indicator" aria-hidden="true"></div></div></div></div><p class="notes">${concept.note}</p></article>`;
}
document.getElementById('concepts').innerHTML=concepts.map(phoneMarkup).join('');
for(const phone of document.querySelectorAll('.phone')) {
  const concept=phone.dataset.concept;
  let hand=[...initialHand], selected=new Set([0]), focusedPlayer=0, showAll=false;
  const groupMarkup=(group,owner,index)=> {
    const possible=matches(group,[...selected].map(i=>hand[i]));
    return `<div class="group${possible?' can-hit':''}"><div class="group-label"><span>${group.label}</span>${possible?'<small>Passt ✓</small>':''}</div><div class="meld">${group.cards.map(c=>cardMarkup(c)).join('')}</div><button class="hit" data-owner="${owner}" data-group="${index}"${possible?'':' disabled'}>Hier anlegen</button></div>`;
  };
  const rowMarkup=(player,index)=>`<section class="player-row"><div class="player-head"><strong>${player.name} · Phase ${player.phase}</strong><span>${player.left} Karten</span></div><div class="groups">${player.groups.map((g,i)=>groupMarkup(g,index,i)).join('')}</div></section>`;
  const toast=message=>phone.querySelector('.toast').textContent=message;
  function render() {
    const table=phone.querySelector('.table-pane'); const previousScroll=table.scrollTop;
    const title=concept==='c'&&!showAll?`${players[focusedPlayer].name} · Ausgelegte Phase`:'Auf dem Tisch';
    table.innerHTML=`<div class="table-title"><h4>${title}</h4><span>${concept==='c'&&!showAll?`${focusedPlayer+1} / 6 Spieler`:'6 Spieler · scrollen ↓'}</span></div>${concept==='c'&&!showAll?rowMarkup(players[focusedPlayer],focusedPlayer):players.map(rowMarkup).join('')}${concept==='c'?`<button class="expand-table" data-expand>${showAll?'Zur Einzelansicht':'Alle Phasen vergleichen'}</button><p class="c-hint">Goldene Punkte markieren Spieler, bei denen deine Auswahl angelegt werden kann.</p>`:''}`;
    table.scrollTop=previousScroll;
    phone.querySelector('.hand').innerHTML=hand.map((c,i)=>cardMarkup(c,true,i,selected.has(i))).join('');
    phone.querySelector('.hand').style.setProperty('--hand-count', String(hand.length));
    phone.querySelector('.selection').textContent=selected.size?`${selected.size} ausgewählt${concept==='a'?'':' · passende Gruppen markiert'}`:concept==='a'?'Karte auswählen':'Karte antippen zum Auswählen';
    if (concept==='a') phone.querySelector('[data-order]').textContent='Zurücksetzen';
    const discard=phone.querySelector('[data-discard]'); discard.disabled=selected.size!==1;
    const chosen=selected.size===1?hand[[...selected][0]]:null;
    discard.textContent=chosen?`${chosen.value===null?'Joker':chosen.value+' '+colorNames[chosen.color]} abwerfen`:'Eine Karte abwerfen';
    const tabs=phone.querySelector('.player-tabs');
    if(tabs) tabs.innerHTML=players.map((p,i)=>`<button class="player-tab${p.groups.some(g=>matches(g,[...selected].map(i=>hand[i])))?' can-hit':''}" role="tab" aria-selected="${focusedPlayer===i&&!showAll}" data-player="${i}">${p.name}</button>`).join('');
  }
  phone.addEventListener('click',event=>{
    const button=event.target.closest('button'); if(!button||button.disabled)return;
    if(button.hasAttribute('data-card')) {const i=Number(button.dataset.card);selected.has(i)?selected.delete(i):selected.add(i);toast('');render();}
    else if(button.hasAttribute('data-player')) {focusedPlayer=Number(button.dataset.player);showAll=false;phone.querySelector('.table-pane').scrollTop=0;render();}
    else if(button.hasAttribute('data-expand')) {showAll=!showAll;phone.querySelector('.table-pane').scrollTop=0;render();}
    else if(button.hasAttribute('data-owner')) toast(`Beispiel: ${selected.size} Karte${selected.size===1?'':'n'} bei ${players[Number(button.dataset.owner)].name} anlegen.`);
    else if(button.hasAttribute('data-discard')) toast('Beispiel: Karte abwerfen und Zug beenden.');
    else if(button.hasAttribute('data-order')) {hand=[...initialHand];selected=new Set([0]);focusedPlayer=0;showAll=false;toast('');render();}
  });
  render();
}
