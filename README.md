# Spiele

Spielesammlung als iPhone-Web-App. Phase10 ist spielbar; Gruselino ist geplant. Phase10 läuft offline gegen Computer, mit lokalem Spielstand und zwei Spielstärken. Ohne Anmeldung oder Tracking.

Starten: `npm ci` und `npm run dev` → http://localhost:5173.
Im gleichen WLAN testen: `npm run dev:lan` → `http://<IP-des-Macs>:5173`.

Prüfen: `npm test`. Bauen: `npm run build` → `dist/`.
Ein Push auf `Dev` veröffentlicht die App über GitHub Pages und erhöht die angezeigte Version automatisch.

Auf dem iPhone über HTTPS in Safari öffnen → Teilen → Zum Home-Bildschirm. Einmal auf „Offline bereit“ warten. Für Updates alle App-Fenster schließen und erneut öffnen.

Code: `src/game/` (Regeln), `src/ai/` (Computer), `src/ui/` (Oberfläche), `src/storage/` (Spielstand und Offlinebetrieb). `scripts/` erzeugt Kartenbilder und die Website; `index.html` wird beim Bauen neu erstellt.

[Sicherheitsprüfung](SECURITY.md) · [Phase10-Regeln von Mattel](https://service.mattel.com/instruction-sheets/files/FFY05%20Phase%2010%20%5BEnglish_French_German_Italian_Dutch%5D%20%5B5LD%5D.PDF)
