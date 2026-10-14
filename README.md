# Spiele

Phase10 (Klassisch, Extrem und Gemischt) und Gruselino für das iPhone: solo gegen Computer oder zu zweit. Gemischt kombiniert fünf klassische und fünf Extrem-Aufgaben in zufälliger Reihenfolge. Solospielstände bleiben auf dem Gerät; die installierte App läuft offline.

`Phase10`, `Gruselino` und `Game-Multiplayer` nebeneinander auschecken und jeweils `npm ci` ausführen.

```sh
npm run dev
```

Öffnen: http://localhost:5173. Handy im selben WLAN: `npm run dev:lan`. Prüfen: `npm test`. Build: `npm run build` → `dist/`.

Auf dem iPhone die HTTPS-Seite in Safari zum Home-Bildschirm hinzufügen und „Offline bereit“ abwarten. Für Updates alle App-Fenster schließen und erneut öffnen. Die Versionsnummer steht auf der Startseite.

Multiplayer über HTTPS oder localhost: Einladungslink teilen und beide Geräte geöffnet lassen. Ohne Internet gibt es den Code-Modus. Gemeinsame Partien werden nicht gespeichert.

Updates in dieser Reihenfolge pushen: Game-Multiplayer → dessen Commit-ID in Gruselinos `multiplayer.json` → Gruselino → dessen Commit-ID hier in `games.json` → Spiele-App. `Dev` veröffentlicht über GitHub Actions.

[Sicherheitsprüfung](SECURITY.md) · [Phase10-Originalregeln](https://service.mattel.com/instruction-sheets/files/FFY05%20Phase%2010%20%5BEnglish_French_German_Italian_Dutch%5D%20%5B5LD%5D.PDF).
