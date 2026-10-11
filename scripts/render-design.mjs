import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { renderPlayingCards } from './render-playing-cards.mjs';
import { appVersion } from './app-version.mjs';
import { connectionService } from './connection-service.mjs';

const root = new URL('../', import.meta.url);
const service = await connectionService(root);
const version = appVersion();
const phases = JSON.parse(await readFile(new URL('src/game/phases.json', root), 'utf8'));
const extremePhases = JSON.parse(await readFile(new URL('src/game/phases-extreme.json', root), 'utf8'));
const specification = JSON.parse(await readFile(new URL('src/game/deck-spec.json', root), 'utf8'));
const source = 'https://service.mattel.com/instruction-sheets/files/FFY05%20Phase%2010%20%5BEnglish_French_German_Italian_Dutch%5D%20%5B5LD%5D.PDF';
const colors = specification.colors.map(color => color.hex);
const paper = '#faf5e9';
const ink = '#193e35';
const muted = '#637368';
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const count = (phase) => phase.groups.reduce((total, group) => total + group.size, 0);
const number = (phase) => String(phase.id).padStart(2, '0');

function svgShell(width, height, title, content, description = 'Phasenkarte für das klassische Phase-10-Kartenspiel.') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${escape(title)}</title><desc id="desc">${escape(description)}</desc>
<defs><pattern id="paper" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".5" fill="#756549" opacity=".07"/></pattern></defs>
<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="22" fill="${paper}"/>
<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="22" fill="url(#paper)"/>
<rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="13" fill="none" stroke="#d7d6c7"/>
<g font-family="Arial, Helvetica, sans-serif" fill="${ink}">${content}</g></svg>\n`;
}

function wrap(text, limit) {
  const lines = [''];
  for (const word of text.split(' ')) {
    const last = lines.length - 1;
    if (lines[last] && (lines[last] + ' ' + word).length > limit) lines.push(word);
    else lines[last] += (lines[last] ? ' ' : '') + word;
  }
  return lines;
}

function example(phase) {
  const total = count(phase);
  const gap = 4;
  const between = 25;
  const width = Math.min(42, (296 - (total - phase.groups.length) * gap - (phase.groups.length - 1) * between) / total);
  const height = width * 1.52;
  const totalWidth = total * width + (total - phase.groups.length) * gap + (phase.groups.length - 1) * between;
  let x = (360 - totalWidth) / 2;
  const y = 231 + (64 - height) / 2;
  let cards = '';
  let cardIndex = 0;
  phase.groups.forEach((group, groupIndex) => {
    if (groupIndex) {
      cards += `<text x="${x + between / 2}" y="272" text-anchor="middle" font-size="20" fill="${muted}">+</text>`;
      x += between;
    }
    group.example.forEach((value, i) => {
      const colorIndex = group.kind === 'color' ? 2 : cardIndex++ % colors.length;
      const color = colors[colorIndex];
      const mark = specification.colors[colorIndex].symbol;
      cards += `<g><rect x="${x}" y="${y + 2}" width="${width}" height="${height}" rx="5" fill="#193e35" opacity=".09"/>
<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="5" fill="#fffdf7" stroke="#d9d7cb"/>
<rect x="${x + 3}" y="${y + 3}" width="${width - 6}" height="3" rx="1" fill="${color}"/>
<text x="${x + width / 2}" y="${y + height * .64}" text-anchor="middle" font-size="${width * .55}" font-weight="700" fill="${color}">${value}</text>
<text x="${x + width / 2}" y="${y + height - 6}" text-anchor="middle" font-size="7" fill="${color}">${mark}</text></g>`;
      x += width + (i < group.example.length - 1 ? gap : 0);
    });
  });
  return cards;
}

function phaseCard(phase, set = 'classic') {
  const detail = wrap(phase.hint, 36).map((line, i) => `<tspan x="32" y="${356 + i * 22}">${escape(line)}</tspan>`).join('');
  const heading = phase.lines.map((line, i) => `<tspan x="32" y="${132 + i * 41}">${escape(line)}</tspan>`).join('');
  return svgShell(360, 480, `${set === 'extreme' ? 'Extrem · ' : ''}Phase ${phase.id}: ${phase.title}`, `
<text x="32" y="48" font-size="11" font-weight="700" letter-spacing="2.2">${set === 'extreme' ? 'EXTREM · PHASE' : 'PHASE'}</text>
<text x="329" y="72" text-anchor="end" font-family="Georgia, serif" font-size="48">${number(phase)}</text>
<path d="M32 67h35" stroke="#bc8c4a" stroke-width="2"/>
<text font-family="Georgia, 'Times New Roman', serif" font-size="34" letter-spacing="-.8">${heading}</text>
<text x="32" y="211" font-size="10" letter-spacing="1.7" fill="${muted}">ZUM BEISPIEL</text>
${example(phase)}
<path d="M32 324h296" stroke="#dad9cd"/>
<text font-size="15" fill="${muted}">${detail}</text>
<text x="32" y="445" font-size="11" font-weight="700" letter-spacing="1">${count(phase)} KARTEN</text>
<text x="328" y="445" text-anchor="end" font-size="11" letter-spacing="1" fill="${muted}">${escape(phase.category.toUpperCase())}</text>`, set === 'extreme' ? 'Eigene schwierigere Phase für die Extrem-Variante.' : 'Phasenkarte für das klassische Phase-10-Kartenspiel.');
}

function overviewCard(list = phases, set = 'classic') {
  const rows = list.map((phase, i) => {
    const y = 174 + i * 43;
    return `<text x="40" y="${y}" font-size="14" fill="${muted}" font-weight="700">${number(phase)}</text>
<text x="83" y="${y}" font-size="19">${escape(phase.title)}</text>
<path d="M40 ${y + 15}h360" stroke="#dfded1"/>`;
  }).join('\n');
  return svgShell(440, 700, set === 'extreme' ? 'Alle zehn Extrem-Phasen: eigene schwierigere Aufgaben' : 'Alle zehn klassischen Phasen in der richtigen Reihenfolge', `
<text x="40" y="51" font-size="11" letter-spacing="2" font-weight="700">PHASE 10${set === 'extreme' ? ' · EXTREM' : ''}</text>
<text x="400" y="51" text-anchor="end" font-size="10" letter-spacing="1.5" fill="${muted}">ÜBERSICHT</text>
<text x="40" y="111" font-family="Georgia, serif" font-size="39" letter-spacing="-1">Die zehn Phasen.</text>
<path d="M40 134h360" stroke="#b98b4e"/>
${rows}
<text x="40" y="630" font-size="14" font-weight="700">Schritt für Schritt, von 1 bis 10.</text>
<text x="40" y="655" font-size="13" fill="${muted}">Eine vollständige Phase pro Runde auslegen.</text>
<circle cx="365" cy="650" r="4" fill="${colors[0]}"/><circle cx="377" cy="650" r="4" fill="${colors[1]}"/><circle cx="389" cy="650" r="4" fill="${colors[2]}"/><circle cx="401" cy="650" r="4" fill="${colors[3]}"/>`);
}

await mkdir(new URL('public/assets/', root), { recursive: true });
for (const [set, list] of [['classic', phases], ['extreme', extremePhases]]) {
  for (const phase of list) await writeFile(new URL(`public/assets/phase-${set === 'extreme' ? 'extreme-' : ''}${number(phase)}.svg`, root), phaseCard(phase, set));
}
await writeFile(new URL('public/assets/phases-overview.svg', root), overviewCard());
await writeFile(new URL('public/assets/phases-extreme-overview.svg', root), overviewCard(extremePhases, 'extreme'));
await writeFile(new URL('public/assets/favicon.svg', root), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#173e34"/><rect x="15" y="10" width="34" height="44" rx="6" fill="#faf5e9" transform="rotate(-9 32 32)"/><text x="32" y="41" font-family="Georgia,serif" font-size="26" text-anchor="middle" fill="#173e34">10</text></svg>\n');

const phaseCards = (list, set = 'classic') => list.map((phase) => `<article class="phase-item" id="phase-${set === 'extreme' ? 'extreme-' : ''}${phase.id}" aria-label="Phase ${phase.id}">
  <img class="phase-card" src="./public/assets/phase-${set === 'extreme' ? 'extreme-' : ''}${number(phase)}.svg" width="360" height="480" loading="lazy" alt="Phase ${phase.id}: ${escape(phase.title)}. ${count(phase)} Karten. ${escape(phase.hint)} Beispiel: ${phase.groups.map((group) => group.example.join(', ')).join(' und ')}.">
  <a class="card-download" href="./public/assets/phase-${set === 'extreme' ? 'extreme-' : ''}${number(phase)}.svg" download="phase-${set === 'extreme' ? 'extreme-' : ''}${number(phase)}.svg">Karte herunterladen <span aria-hidden="true">↗</span></a>
</article>`).join('\n');
const phaseRows = (list, set = 'classic') => list.map((phase) => `<li><a href="#phase-${set === 'extreme' ? 'extreme-' : ''}${phase.id}"><span class="phase-number">${number(phase)}</span><span>${escape(phase.title)}</span><span class="row-arrow" aria-hidden="true">↗</span></a></li>`).join('\n');
const cards = phaseCards(phases), rows = phaseRows(phases);
const extremeCards = phaseCards(extremePhases, 'extreme'), extremeRows = phaseRows(extremePhases, 'extreme');
const deckSection = await renderPlayingCards({ root, specification, svgShell, escape, paper, ink, muted });

await writeFile(new URL('index.html', root), `<!doctype html>
<!-- Generated with node scripts/render-design.mjs. Phase definitions: src/game/phases*.json. -->
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; img-src 'self'; font-src 'self'; connect-src 'self'${service ? ' ' + service : ''}; worker-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#173e34">
  <meta name="description" content="Spiele auswählen und offline spielen. Spielstände bleiben auf diesem Gerät.">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Spiele">
  <title>Spiele</title>
  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="apple-touch-icon" href="./public/assets/app-icon-180.png">
  <link rel="icon" href="./public/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="./src/ui/phase-cards.css">
  <link rel="stylesheet" href="./src/ui/game-table.css">
  <link rel="stylesheet" href="./public/games/gruselino/assets/gruselino.css">
  <script type="module" src="./public/app/main.js"></script>
</head>
<body class="is-home">
  <a class="skip-link" href="#home">Zur Spieleauswahl</a>
  <header class="site-header">
    <div class="brand"><a class="wordmark" href="#home" aria-label="Zur Spieleauswahl">Spiele<i aria-hidden="true"></i></a><span class="app-version" id="app-version">Version ${escape(version)}</span></div>
    <nav aria-label="Seitennavigation"><a href="#home">Alle Spiele</a><a href="#game" data-phase-nav>Phase10</a><a href="#overview" data-phase-nav>Regeln</a></nav>
  </header>
  <main>
    <section class="games-home" id="home" aria-labelledby="home-title">
      <div class="home-heading"><h1 id="home-title">Welches Spiel?</h1><p>Wähle ein Spiel aus.</p></div>
      <div class="games-grid">
        <article class="game-tile">
          <div class="tile-art phase-art" aria-hidden="true"><img src="./public/assets/card-red-07.svg" width="240" height="336" alt=""><img src="./public/assets/card-blue-07.svg" width="240" height="336" alt=""><img src="./public/assets/card-green-07.svg" width="240" height="336" alt=""></div>
          <div class="tile-copy"><span class="game-tag">Kartenspiel</span><h2>Phase10</h2><p>Zehn Phasen gegen Computergegner.</p><a class="game-link" id="phase10-link" href="#game">Spielen <span aria-hidden="true">→</span></a><p class="saved-game" id="saved-game" hidden></p></div>
        </article>
        <article class="game-tile">
          <div class="tile-art ghost-art" aria-hidden="true"><img src="./public/games/gruselino/assets/ghost.svg" width="128" height="128" alt=""><span class="ghost-shadow"></span></div>
          <div class="tile-copy"><span class="game-tag">Suchspiel</span><h2>Gruselino</h2><p>Finde die fehlende Figur.</p><a class="game-link" id="gruselino-link" href="#gruselino">Spielen <span aria-hidden="true">→</span></a><p class="saved-game" id="gruselino-saved" hidden></p></div>
        </article>
      </div>
      <div id="home-tools"></div>
      <noscript><p>Bitte aktiviere JavaScript, um ein Spiel zu öffnen.</p></noscript>
    </section>
    <section id="gruselino" aria-label="Gruselino">
      <div id="gruselino-root"></div>
      <div id="gruselino-tools"></div>
    </section>
    <section class="game-section" id="game" aria-labelledby="game-title">
      <div class="section-heading"><div><h1 id="game-title">Phase10 spielen</h1></div></div>
      <div class="game-table" id="game-root"><p>Der Spieltisch wird geladen.</p></div>
      <p class="storage-status" id="storage-status" role="status"></p>
      <div class="app-tools">
        <p class="offline-status" id="offline-status" role="status">Offlinebetrieb wird vorbereitet …</p>
        <details class="install-guide" id="install-guide">
          <summary>Als App installieren</summary>
          <p>Auf dem iPhone:</p>
          <ol><li>Diese Seite in Safari öffnen und auf „Teilen“ tippen.</li><li>„Zum Home-Bildschirm“ wählen. Falls angezeigt, „Als Web-App öffnen“ einschalten und auf „Hinzufügen“ tippen.</li><li>Die App über das neue Symbol öffnen und einmal online warten, bis „Offline bereit“ erscheint. Danach kannst du ohne Internet spielen.</li></ol>
          <p>Auf anderen Geräten findest du „App installieren“ im Browsermenü, sofern unterstützt.</p>
        </details>
      </div>
      <p class="visually-hidden" id="game-announcement" role="status"></p>
      <noscript><p>Bitte aktiviere JavaScript, um das Spiel zu starten.</p></noscript>
    </section>
    <section class="intro reference-intro" aria-labelledby="page-title">
      <h1 id="page-title">Phasen und Regeln</h1>
      <label class="reference-choice" for="reference-phase-set">Phasen<select id="reference-phase-set"><option value="classic">Klassisch</option><option value="extreme">Extrem</option></select></label>
    </section>
    <section class="overview-section" id="overview" data-phase-reference="classic" aria-labelledby="overview-title">
      <div class="overview-card">
        <div class="overview-top"><span>PHASE 10</span><span>ÜBERSICHT</span></div>
        <h2 id="overview-title">Die zehn Phasen.</h2>
        <ol class="phase-list">${rows}</ol>
        <div class="overview-bottom"><span>Eine Phase pro Runde.</span><span class="color-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div>
      </div>
      <aside class="guide" aria-labelledby="guide-title">
        <div class="sample-hand" aria-hidden="true"><span>7<small>●</small></span><span>7<small>■</small></span><span>7<small>▲</small></span></div>
        <p class="eyebrow">KURZ ERKLÄRT</p>
        <h2 id="guide-title">So legst du eine Phase</h2>
        <p>Lege deine aktuelle Phase vollständig aus. Wer das schafft, spielt in der nächsten Runde die nächste Phase. Andernfalls wird dieselbe Phase wiederholt.</p>
        <dl class="definitions">
          <div><dt>Gleiche Zahl</dt><dd>Ein Drilling besteht aus drei gleichen Zahlen, ein Vierling aus vier. Die Farbe ist dabei egal.</dd></div>
          <div><dt>Direkt hintereinander</dt><dd>Eine Folge hat aufeinanderfolgende Zahlen ohne Lücken. Auch hier sind die Farben frei.</dd></div>
          <div><dt>Gleiche Farbe</dt><dd>In Phase 8 zählt die Kartenfarbe. Die Zahlen dürfen ganz unterschiedlich sein.</dd></div>
        </dl>
        <details class="wild-note"><summary>Und die Joker?</summary><p>Joker ersetzen eine Zahl oder eine Farbe. Jede ausgelegte Phase muss mindestens eine Zahlenkarte enthalten. Ein ausgelegter Joker bleibt bis zum Rundenende an seinem Platz.</p></details>
        <a class="download-link" href="./public/assets/phases-overview.svg" download="phasen-uebersicht.svg">Übersicht als Karte herunterladen <span aria-hidden="true">↓</span></a>
      </aside>
    </section>
    <section class="overview-section" id="overview-extreme" data-phase-reference="extreme" aria-labelledby="extreme-overview-title" hidden>
      <div class="overview-card">
        <div class="overview-top"><span>PHASE 10 · EXTREM</span><span>ÜBERSICHT</span></div>
        <h2 id="extreme-overview-title">Die zehn Extrem-Phasen.</h2>
        <ol class="phase-list">${extremeRows}</ol>
        <div class="overview-bottom"><span>Eine Phase pro Runde.</span><span class="color-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div>
      </div>
      <aside class="guide" aria-labelledby="extreme-guide-title">
        <p class="eyebrow">EIGENE VARIANTE</p>
        <h2 id="extreme-guide-title">Größere Aufgaben.</h2>
        <p>Du startest mit einem Fünfling und einem Drilling. Danach warten längere Folgen, größere Gruppen und neun Karten einer Farbe.</p>
        <p>Jede Phase braucht acht bis zehn Karten. Du erhältst weiterhin zehn Handkarten und ziehst zu Beginn deines Zuges eine Karte. Joker, Anlegen, Aussetzen und Punkte funktionieren wie gewohnt.</p>
        <p>Lege die ganze Phase auf einmal aus. Wer seine Phase schafft, spielt in der nächsten Runde die nächste; sonst wird sie wiederholt.</p>
        <a class="download-link" href="./public/assets/phases-extreme-overview.svg" download="extrem-phasen-uebersicht.svg">Extrem-Übersicht herunterladen <span aria-hidden="true">↓</span></a>
      </aside>
    </section>
    ${deckSection}
    <section class="cards-section" id="cards" data-phase-reference="classic" aria-labelledby="cards-title">
      <div class="section-heading"><div><h2 id="cards-title">Phasenkarten</h2></div><span>01 — 10</span></div>
      <p class="section-copy">Die Zahlen auf den Karten sind Beispiele. Du kannst jede passende Kombination bilden.</p>
      <div class="card-grid">${cards}</div>
    </section>
    <section class="cards-section" id="cards-extreme" data-phase-reference="extreme" aria-labelledby="extreme-cards-title" hidden>
      <div class="section-heading"><div><h2 id="extreme-cards-title">Extrem-Phasenkarten</h2></div><span>01 — 10</span></div>
      <p class="section-copy">Eigene, schwierigere Phasen. Die abgebildeten Zahlen sind Beispiele.</p>
      <div class="card-grid">${extremeCards}</div>
    </section>
  </main>
  <footer><span>Spielstände bleiben auf diesem Gerät.</span><a href="${source}" target="_blank" rel="noopener noreferrer">Phase10-Regeln: Mattel <span aria-hidden="true">↗</span></a></footer>
</body>
</html>
`);
console.log('Created the preview, 20 phase cards, 50 playing-card faces, the card back and a deck of 108 cards.');
