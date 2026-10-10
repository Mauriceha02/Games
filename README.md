# Phase10

Ein Kartenspiel als installierbare Web-App auf dem iPhone.

Geplant:

- Offline gegen Computergegner spielen.
- Spielstände automatisch lokal speichern und später fortsetzen.
- Ohne Anmeldung, Werbung oder Tracking.
- Später gemeinsam im WLAN spielen.

Technik: TypeScript, HTML/CSS und eine PWA. Hosting über GitHub Pages vorgesehen.

Ordner:

```text
src/ui/         Oberfläche und Bedienung
src/game/       Karten, Regeln und Spielablauf
src/ai/         Computergegner
src/storage/    Lokale Spielstände
public/assets/ Bilder, Schriften und Sounds
```

Designvorschau: `index.html` im Browser öffnen. Phasenkarten liegen als SVG in `public/assets/`.

Phasenquelle: [Mattel-Spielanleitung (klassische Ausgabe)](https://service.mattel.com/instruction-sheets/files/FFY05%20Phase%2010%20%5BEnglish_French_German_Italian_Dutch%5D%20%5B5LD%5D.PDF).

Design neu erzeugen: `node scripts/render-design.mjs`.

Status: Phasenkarten gestaltet; Spiellogik und Offline-Installation folgen.
