# Spiele

Spielesammlung als iPhone-Web-App. Phase10 und Gruselino laufen offline gegen Computer, mit eigenen lokalen Spielständen. Beide Spiele lassen sich auch zu zweit im WLAN spielen. Ohne Anmeldung oder Tracking.

Starten: Gruselino und Game-Multiplayer neben diesem Repository auschecken und in beiden `npm ci` ausführen. Hier `npm ci` und `npm run dev` → http://localhost:5173.
Im gleichen WLAN testen: `npm run dev:lan` → `http://<IP-des-Macs>:5173`.

Prüfen: `npm test`. Bauen: `npm run build` → `dist/`.
Ein Push auf `Dev` veröffentlicht die App über GitHub Pages und erhöht die angezeigte Version automatisch.

Auf dem iPhone über HTTPS in Safari öffnen → Teilen → Zum Home-Bildschirm. Einmal auf „Offline bereit“ warten. Für Updates alle App-Fenster schließen und erneut öffnen.

Code: `src/game/` (Regeln), `src/ai/` (Computer), `src/ui/` (Oberfläche), `src/storage/` (Spielstand und Offlinebetrieb). `scripts/` erzeugt Kartenbilder und die Website; `index.html` wird beim Bauen neu erstellt.

Gruselino bleibt im [eigenen Repository](https://github.com/Mauriceha02/Gruselino). `games.json` legt seine Commit-ID fest. Lokal muss Gruselino auf diesem Commit stehen und sauber sein; alternativ den Pfad mit `GRUSELINO_SOURCE` setzen. CI holt genau diesen Stand. Für ein Update zuerst Gruselino prüfen, committen und pushen, dann die Commit-ID in `games.json` ändern und diese App pushen.

„Mitspieler im WLAN“: bei Gruselino auf der Startansicht, bei Phase10 unter „Neue Partie“ oder im Spielmenü. Einladungslink teilen; das zweite Gerät verbindet sich beim Öffnen automatisch. Ohne Internet kann unter „Ohne Internet per Code verbinden“ weiterhin eine Einladung mit Antwortcode verwendet werden. Beide Geräte geöffnet lassen. Schließen, Neuladen oder Verlassen beendet die gemeinsame Partie; die Solospielstände bleiben erhalten. Bei Phase10 sieht jeder nur seine eigene Hand; der Gastgeber prüft die Züge und startet die nächste Runde.

Das [Verbindungsmodul](https://github.com/Mauriceha02/Game-Multiplayer) ist über Gruselinos `multiplayer.json` festgelegt; alternativ `MULTIPLAYER_SOURCE` setzen. Seine `connection.json` legt den Cloudflare-Verbindungsdienst fest. Er tauscht nur die Verbindungsdaten aus und löscht sie spätestens nach 15 Minuten; Spieler brauchen kein Konto. Die optionale Internet-Hilfe nutzt STUN. Partien über verschiedene Netze sind damit möglich, aber ohne TURN-Relay nicht überall erreichbar. [Verbindungswege](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols).

[Sicherheitsprüfung](SECURITY.md) · [Phase10-Regeln von Mattel](https://service.mattel.com/instruction-sheets/files/FFY05%20Phase%2010%20%5BEnglish_French_German_Italian_Dutch%5D%20%5B5LD%5D.PDF)

Umbenennen in `Games`: Auf GitHub unter „Settings → General → Repository name“ den Namen ändern, danach `git remote set-url origin https://github.com/Mauriceha02/Games.git` und `Dev` pushen. Die neue Pages-Adresse ist `https://mauriceha02.github.io/Games/`; GitHub leitet die alte Website nicht automatisch weiter. Die App nutzt relative Pfade. Auf dem iPhone die neue Adresse zum Home-Bildschirm hinzufügen; das bisherige Symbol erst entfernen, wenn die Spielstände in der neuen Installation geprüft sind.
