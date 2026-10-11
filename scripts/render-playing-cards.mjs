import { mkdir, writeFile } from 'node:fs/promises';

/** Render the faces once and reference them from every physical copy in the deck. */
export async function renderPlayingCards({ root, specification, svgShell, escape, paper, ink, muted }) {
  const assets = new URL('public/assets/', root);
  await mkdir(assets, { recursive: true });
  const deck = [];
  const facePath = (color, value) => `public/assets/card-${color.id}-${String(value).padStart(2, '0')}.svg`;

  function corners(value, symbol, color) {
    const corner = `<text x="28" y="51" text-anchor="middle" font-family="Georgia, serif" font-size="26" font-weight="700" fill="${color}">${escape(value)}</text>
<text x="28" y="71" text-anchor="middle" font-size="11" fill="${color}">${symbol}</text>`;
    return `<g>${corner}</g><g transform="rotate(180 120 168)">${corner}</g>`;
  }

  function numberCard(color, value) {
    return svgShell(240, 336, `${color.label}: ${value}`, `
${corners(value, color.symbol, color.hex)}
<ellipse cx="120" cy="168" rx="76" ry="101" fill="${color.hex}" opacity=".035"/>
<ellipse cx="120" cy="168" rx="68" ry="92" fill="none" stroke="${color.hex}" stroke-opacity=".24"/>
<text x="120" y="194" text-anchor="middle" font-family="Georgia, serif" font-size="${value < 10 ? 108 : 91}" letter-spacing="-5" fill="${color.hex}">${value}</text>
<text x="120" y="228" text-anchor="middle" font-size="13" fill="${color.hex}">${color.symbol}</text>
<text x="120" y="249" text-anchor="middle" font-size="8" font-weight="700" letter-spacing="2" fill="${color.hex}">${escape(color.label.toUpperCase())}</text>`, `Zahlenkarte ${value} in ${color.label}. Das Symbol ${color.symbol} kennzeichnet die Farbe zusätzlich.`);
  }

  function specialCard(special) {
    const wild = special.type === 'wild';
    const illustration = wild
      ? `<path d="M120 80 176 136 120 136Z" fill="${specification.colors[0].hex}"/>
<path d="M176 136 120 192 120 136Z" fill="${specification.colors[1].hex}"/>
<path d="M120 192 64 136 120 136Z" fill="${specification.colors[2].hex}"/>
<path d="M64 136 120 80 120 136Z" fill="${specification.colors[3].hex}"/>
<path d="m120 106 8 22 22 8-22 8-8 22-8-22-22-8 22-8Z" fill="${paper}"/>
<text x="120" y="235" text-anchor="middle" font-family="Georgia, serif" font-size="35">Joker</text>
<text x="120" y="258" text-anchor="middle" font-size="10" fill="${muted}">Zahl oder Farbe ersetzen</text>`
      : `<circle cx="120" cy="143" r="43" fill="none" stroke="${ink}" stroke-width="6"/>
<path d="m89 112 62 62" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>
<text x="120" y="235" text-anchor="middle" font-family="Georgia, serif" font-size="29">Aussetzen</text>
<text x="120" y="258" text-anchor="middle" font-size="10" fill="${muted}">Ein Spieler setzt aus</text>`;
    return svgShell(240, 336, special.label, `${corners(wild ? '✦' : 'Ø', '', ink)}
<text x="120" y="48" text-anchor="middle" font-size="8" letter-spacing="1.5" fill="${muted}">PHASE 10</text>
${illustration}`, wild ? 'Jokerkarte. Ersetzt eine Zahl oder eine Farbe in einer Phase.' : 'Aussetzen-Karte. Lässt einen anderen Spieler einen Zug aussetzen.');
  }

  function cardBack() {
    return svgShell(240, 336, 'Kartenrückseite', `
<rect x="18" y="18" width="204" height="300" rx="8" fill="${ink}"/>
<rect x="26" y="26" width="188" height="284" rx="4" fill="none" stroke="#d9b579" stroke-opacity=".65"/>
<path d="M120 56 199 168 120 280 41 168Z" fill="none" stroke="#d9b579" stroke-opacity=".28"/>
<path d="M120 69 189 168 120 267 51 168Z" fill="none" stroke="#d9b579" stroke-opacity=".16"/>
<text x="120" y="137" text-anchor="middle" font-size="12" letter-spacing="4" fill="${paper}">PHASE</text>
<text x="120" y="211" text-anchor="middle" font-family="Georgia, serif" font-size="81" letter-spacing="-4" fill="${paper}">10</text>
<path d="M92 228h56" stroke="#d9b579"/>
<text x="120" y="82" text-anchor="middle" font-size="12" fill="#d9b579">✦</text>
<text x="120" y="267" text-anchor="middle" font-size="12" fill="#d9b579">✦</text>`, 'Einheitliche Rückseite für alle Spielkarten.');
  }

  const panels = [];
  for (const color of specification.colors) {
    const faces = [];
    for (let value = specification.numbers.first; value <= specification.numbers.last; value++) {
      const asset = facePath(color, value);
      await writeFile(new URL(asset, root), numberCard(color, value));
      for (let copy = 1; copy <= specification.numbers.copiesPerColor; copy++) {
        deck.push({ id: `${color.id}-${value}-${copy}`, type: 'number', color: color.id, value, asset });
      }
      faces.push(`<a class="playing-face" href="./${asset}" download aria-label="${escape(color.label)} ${value}, SVG herunterladen"><img src="./${asset}" width="240" height="336" loading="lazy" alt="${escape(color.label)} ${value}"></a>`);
    }
    const total = faces.length * specification.numbers.copiesPerColor;
    panels.push(`<div class="deck-color-panel deck-color-${color.id}" id="panel-${color.id}" role="region" aria-label="${escape(color.label)}e Zahlenkarten"><div class="deck-color-heading"><h3>${escape(color.label)}</h3><span>${total} Karten · jede Zahl ${specification.numbers.copiesPerColor}×</span></div><div class="number-card-grid">${faces.join('\n')}</div></div>`);
  }

  const specialFaces = [];
  for (const special of specification.specials) {
    const asset = `public/assets/card-${special.type}.svg`;
    await writeFile(new URL(asset, root), specialCard(special));
    for (let copy = 1; copy <= special.copies; copy++) {
      deck.push({ id: `${special.type}-${copy}`, type: special.type, color: null, value: null, asset });
    }
    specialFaces.push(`<figure class="special-card"><a class="playing-face" href="./${asset}" download aria-label="${escape(special.label)}, SVG herunterladen"><img src="./${asset}" width="240" height="336" loading="lazy" alt="${escape(special.label)}"></a><figcaption><strong>${special.copies}× ${escape(special.label)}</strong><span>${special.type === 'wild' ? 'Ersetzt eine Zahl oder Farbe.' : 'Ein anderer Spieler setzt einen Zug aus.'}</span></figcaption></figure>`);
  }
  await writeFile(new URL('public/assets/card-back.svg', root), cardBack());
  await writeFile(new URL('src/game/deck.json', root), JSON.stringify(deck, null, 2) + '\n');

  const numberTotal = deck.filter(card => card.type === 'number').length;
  const filters = specification.colors.map((color, index) => `<input class="visually-hidden" type="radio" name="deck-color" id="color-${color.id}" aria-controls="panel-${color.id}"${index === 0 ? ' checked' : ''}><label class="color-choice" for="color-${color.id}"><span aria-hidden="true">${color.symbol}</span>${escape(color.label)}</label>`).join('\n');
  const rows = specification.colors.map(color => `<tr><th scope="row">${escape(color.label)}</th><td>${specification.numbers.first}–${specification.numbers.last}</td><td>${specification.numbers.copiesPerColor}× pro Zahl</td><td>${(specification.numbers.last - specification.numbers.first + 1) * specification.numbers.copiesPerColor}</td></tr>`).join('\n');
  const specials = specification.specials.map(special => `<tr><th scope="row">${escape(special.label)}</th><td>—</td><td>${special.copies}×</td><td>${special.copies}</td></tr>`).join('\n');

  return `<section class="cards-section deck-section" id="deck" aria-labelledby="deck-title">
  <div class="section-heading"><div><h2 id="deck-title">Das Deck: ${deck.length} Karten</h2></div><span>${numberTotal} + ${specification.specials.map(special => special.copies).join(' + ')}</span></div>
  <p class="section-copy">Jede Zahl von ${specification.numbers.first} bis ${specification.numbers.last} gibt es zweimal pro Farbe. Dazu kommen Joker und Aussetzen-Karten.</p>
  <div class="deck-summary"><table><caption class="visually-hidden">Zusammensetzung des klassischen Spieldecks</caption><thead><tr><th scope="col">Karten</th><th scope="col">Zahlen</th><th scope="col">Häufigkeit</th><th scope="col">Anzahl</th></tr></thead><tbody>${rows}${specials}</tbody><tfoot><tr><th scope="row" colspan="3">Spielkarten insgesamt</th><td>${deck.length}</td></tr></tfoot></table><p>${specification.referenceCards} Übersichtskarten liegen zusätzlich bei: ${deck.length + specification.referenceCards} Karten in der klassischen Packung. Die Übersichten werden nicht eingemischt.</p></div>
  <fieldset class="deck-color-picker"><legend class="visually-hidden">Farbe der Zahlenkarten auswählen</legend>${filters}<div class="deck-color-panels">${panels.join('\n')}</div></fieldset>
  <div class="special-card-grid">${specialFaces.join('\n')}<figure class="special-card"><a class="playing-face" href="./public/assets/card-back.svg" download aria-label="Kartenrückseite, SVG herunterladen"><img src="./public/assets/card-back.svg" width="240" height="336" loading="lazy" alt="Dunkelgrüne Kartenrückseite mit Phase 10"></a><figcaption><strong>Die Rückseite</strong><span>Für alle ${deck.length} Spielkarten gleich.</span></figcaption></figure></div>
  <p class="deck-download-note">Tippe auf eine Spielkarte, um ihr SVG herunterzuladen.</p>
</section>`;
}
