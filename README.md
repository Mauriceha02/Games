# Phase10

Ein Kartenspiel als installierbare Web-App auf dem iPhone.

Geplant:

- Offline gegen Computergegner spielen.
- Spielstände automatisch lokal speichern und später fortsetzen.
- Ohne Anmeldung, Werbung oder Tracking.
- Später gemeinsam im WLAN spielen.

Technik: TypeScript und HTML/CSS. PWA und Hosting über GitHub Pages folgen.

Ordner:

```text
src/ui/         Oberfläche und Bedienung
src/game/       Karten, Regeln und Spielablauf
src/ai/         Computergegner
src/storage/    Lokale Spielstände
public/assets/ Bilder, Schriften und Sounds
```

Start: `npm install`, danach `npm run dev`. Im Browser: http://localhost:5173.

Handy testen: Den lokalen Server mit `Ctrl+C` stoppen und `npm run dev:lan` starten. Mac und Handy müssen im gleichen WLAN sein. Auf dem Handy `http://<IP-des-Macs>:5173` öffnen; der Mac muss währenddessen laufen.

Prüfen: `npm test`. Bauen: `npm run build`. Phasen- und Spielkarten liegen als SVG in `public/assets/`.

Deck: 108 Spielkarten – Zahlen 1–12 je 2× pro Farbe, 8 Joker, 4 Aussetzen. Spezifikation und vollständiges Deck liegen in `src/game/`.

Phasenquelle: [Mattel-Spielanleitung (klassische Ausgabe)](https://service.mattel.com/instruction-sheets/files/FFY05%20Phase%2010%20%5BEnglish_French_German_Italian_Dutch%5D%20%5B5LD%5D.PDF).

Design neu erzeugen: `node scripts/render-design.mjs`.

Status: Alle zehn Phasen prüfen/auslegen, Karten anlegen, Rundenfortschritt, Hand ordnen und lokale Spielstände sind umgesetzt. Computer: Einfach oder Stark, auch gemischt und während der Partie umstellbar. Beide nutzen Joker und Aussetzen gezielt; Joker-Abwurf nur, wenn kein anderer legaler Zug bleibt. Der starke Bot plant seine Phase und vermeidet erkennbare Hilfe für Mitspieler, ohne verdeckte Hände zu kennen. Offline-Installation folgt.
