# Sicherheitsprüfung

Stand: 11. Oktober 2026. Geprüft wurden Phase10 einschließlich Extrem-Modus, Gruselino, das gemeinsame WebRTC-Modul, der Cloudflare-Einladungsdienst, Spielstände, Offline-Caches, Veröffentlichungsdateien, Abhängigkeiten und GitHub-Actions-Workflows.

## Korrekturen

- **Gruselino:** Verdeckte Karten wurden bereits vor dem Aufdecken an den Gast übertragen. Jetzt enthalten Ladeanzeige, Countdown und Pause keine Kartenfiguren. Erst beim Aufdecken wird die aktuelle Karte übertragen; der übrige Stapel bleibt beim Gastgeber. Außerdem lässt sich die Sperre nach einer falschen Antwort nicht mehr durch Pause und Fortsetzen umgehen. Das Nachrichtenformat ist dafür Version 2; beide Geräte brauchen die aktuelle App.
- **Multiplayer:** Eine Nachrichtenflut, auch mit wiederholten Nachrichten, schließt die Verbindung ab mehr als 64 Nachrichten innerhalb einer Sekunde. Einzelne Nachrichten bleiben auf 16 KiB begrenzt; übergroße Zeichenketten werden vor weiterer UTF-8-Verarbeitung abgewiesen.
- **Einladungsantworten:** Antworten des Verbindungsdienstes werden beim Lesen auf 70.000 Bytes begrenzt. Zu große Datenströme werden abgebrochen, bevor eine Verbindung daraus vorbereitet wird.
- **Spielstände:** Beide Spiele laden und speichern höchstens 65.536 Zeichen. Ungültige oder übergroße gespeicherte Daten werden gemeldet und beim Laden nicht überschrieben.
- **Offline:** Gruselinos eigene Installation berücksichtigt URL-Fragmente, ohne Einladungen im Cache-Schlüssel zu speichern.

## Vorhandener Schutz

Texte aus Spielständen und Nachrichten werden geprüft und bei HTML-Ausgabe maskiert. Karten und Figuren kommen aus lokalen, geprüften Pfaden. Die CSP erlaubt lokale Skripte und als externen HTTP-Verbindungsdienst nur die konfigurierte Cloudflare-Adresse. Keine Tracker und keine Kamera-, Mikrofon- oder Standortabfragen.

Phase10 prüft am Gastgeber Rolle, Zug, Kartenbesitz und Zustandsnummer. Der Gast erhält nur seine Hand und öffentliche Spieldaten. Gruselino vergibt jede Karte einmal, verwirft veraltete Antworten und setzt falsche Antworten auch am Gastgeber für 1,5 Sekunden aus.

Der Einladungsdienst benötigt getrennte zufällige 128-Bit-Schlüssel für Gastgeber und Gast. Antworten können nicht überschrieben werden. Einladungen gelten regulär 15 Minuten; der Validator toleriert zusätzlich eine Minute Uhrabweichung. Verbindungsdaten werden nach Antwortübernahme gelöscht, sonst bei einem Zugriff nach Ablauf oder per Alarm entfernt. Er speichert technische WebRTC-Daten, keine Handkarten, Punkte oder Solospielstände. HTTP-Anfragen sind auf 70.000 Bytes und derzeit 100 Anfragen pro Minute je IP und Cloudflare-Standort begrenzt. Worker-Logs sind in der Konfiguration deaktiviert.

Der Build veröffentlicht nur freigegebene Dateien und weist versteckte Dateien sowie symbolische Links zurück. Die Spiele binden exakte Git-Commits ein. GitHub Actions verwendet festgelegte Action-Commits, minimale Rechte und `npm ci --ignore-scripts`.

## Grenzen

- Solospielstände liegen unverschlüsselt in `localStorage`. Seiten unter demselben Host `mauriceha02.github.io` teilen im gleichen Browser-Speicherbereich den Origin-Speicher; Unterordner trennen ihn nicht. [Same-Origin-Regeln](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy).
- Der Gastgeber ist eine Vertrauensperson: Er kennt bei Phase10 beide Hände und könnte einen veränderten Client einsetzen. Auch nach dem Aufdecken kann ein veränderter Gruselino-Client automatisch antworten. Die Prüfung ersetzt keinen serverseitigen Schutz vor Betrug; Netzverzögerung beeinflusst die Gewinnentscheidung.
- Einladungslinks berechtigen zum Beitritt und gehören nur an den gewünschten Mitspieler. HTTPS und WebRTC verschlüsseln die Übertragung; Hosting-, Vermittlungs- und optional Google-STUN-Anbieter verarbeiten nötige Verbindungsdaten. Ohne TURN funktionieren nicht alle Netze.
- Herkunftsprüfung und Rate-Limit sind zusätzliche Hürden, keine Benutzeranmeldung und kein vollständiger Schutz vor Dienstüberlastung. Das Rate-Limit gilt [je Cloudflare-Standort](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
- Die Meta-CSP von GitHub Pages bietet keinen vollständigen Schutz vor fremdem Einbetten: `frame-ancestors` braucht einen HTTP-Header. Auch veröffentlichter Schadcode oder ein kompromittiertes GitHub-Konto bleiben außerhalb ihres Schutzes. [CSP-Dokumentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).

## Nachweise

Alle **148 Tests** bestanden: 102 in der Spiele-App, 26 in Gruselino und 20 im Multiplayer-Modul. Sie prüfen unter anderem verdeckte Karten, Manipulationsversuche, Nachrichtenfluten, Datengrenzen, Rollen, abgelaufene Einladungen, HTML-Ausgabe und Offline-Caches. Die aktuellen `npm audit`-Abfragen melden in allen drei Repositories und im Worker keine bekannten Schwachstellen.

Chrome und WebKit: Beide Spiele verbinden sich über den bestehenden HTTPS-Dienst. Übertragene Spielstände enthalten keine fremde Phase10-Hand und keine verdeckten Gruselino-Karten. Pause, Fortsetzen, Punkte und weitere Karten funktionieren; die Partie läuft bei blockiertem Verbindungsdienst weiter und verändert keine Solospielstände.

Beide Spiele und die Multiplayer-Testseite blockierten in beiden Browsern präparierte Inline-Skripte, Event-Handler, fremde Skripte/Bilder, Inline-Styles und fremde Basis-URLs. Präparierte Spielstände führten keine Skripte aus. 16 gezielte HTTP-Prüfungen am veröffentlichten Dienst bestätigten Herkunftsprüfung, Zugangsschlüssel, Rollen, Größenbegrenzung, einmalige Antworten und Löschen.

Ein mustergestützter Scan getrackter Dateien und der Git-Historie fand keine verdächtigen Zugangsdaten. Die SVG-Prüfung fand keine Skripte, Event-Handler oder externen Ressourcen. Alte Planungsdateien wurden entfernt und READMEs gekürzt.

Eine Codeprüfung beweist keine vollständige Sicherheit. GitHub-/Cloudflare-Kontorechte und das Verhalten einer echten iPhone-Installation wurden in dieser Prüfung nicht vollständig geprüft.
