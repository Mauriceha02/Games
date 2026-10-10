# Phase10

Ein Kartenspiel als installierbare Web-App auf dem iPhone.

Umgesetzt:

- Offline gegen Computergegner spielen.
- Spielstände automatisch lokal speichern und später fortsetzen.
- Ohne Anmeldung, Werbung oder Tracking.
- Zehn Phasen, Karten anlegen, Hand ordnen und zwei Bot-Stärken.

Technik: TypeScript und HTML/CSS, installierbare PWA. WLAN-Mehrspieler folgt.

Ordner:

```text
src/ui/         Oberfläche und Bedienung
src/game/       Karten, Regeln und Spielablauf
src/ai/         Computergegner
src/storage/    Lokale Spielstände und Offline-Cache
public/assets/ Bilder, Schriften und Sounds
```

Start: `npm install`, danach `npm run dev`. Im Browser: http://localhost:5173.

Handy testen: `npm run dev:lan`, dann im gleichen WLAN `http://<IP-des-Macs>:5173` öffnen. Der Mac muss dabei laufen. Über diesen HTTP-Testlink funktioniert der Offlinebetrieb auf dem iPhone noch nicht.

Installieren: Über HTTPS in Safari öffnen → Teilen → Zum Home-Bildschirm. Falls angezeigt, „Als Web-App öffnen“ einschalten. Die App danach einmal online öffnen, bis „Offline bereit“ erscheint. Jetzt lässt sie sich ohne Internet öffnen und weiterspielen. Spielstände bleiben auf diesem Gerät; Updates wechseln erst, wenn alle App-Fenster geschlossen wurden.

Prüfen: `npm test`. Bauen: `npm run build` erzeugt `dist/` mit allen Dateien fürs statische Hosting, auch unter einem Unterpfad wie `/Phase10/`. Lokal lässt sich Offlinebetrieb über `localhost` testen.

Hosting: Der Workflow `.github/workflows/pages.yml` prüft jeden Push und Pull Request. Nach bestandenen Tests veröffentlicht er den Branch `Dev` auf GitHub Pages; andere Branches werden nur geprüft. Pages verwendet **Settings → Pages → Source → GitHub Actions**. Updates durch einen Push auf `Dev`; den HTTPS-Link zeigt der erfolgreiche Deploy-Schritt an.

GitHub Pages ist mit GitHub Free für öffentliche Repositories kostenlos; Code und Website sind dann öffentlich. Spielstände werden nicht hochgeladen. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Deck: 108 Spielkarten – Zahlen 1–12 je 2× pro Farbe, 8 Joker, 4 Aussetzen. Spezifikation und vollständiges Deck liegen in `src/game/`.

Phasenquelle: [Mattel-Spielanleitung (klassische Ausgabe)](https://service.mattel.com/instruction-sheets/files/FFY05%20Phase%2010%20%5BEnglish_French_German_Italian_Dutch%5D%20%5B5LD%5D.PDF).

Karten-Design neu erzeugen: `node scripts/render-design.mjs`. Das App-Symbol liegt als SVG und PNG in `public/assets/`.
