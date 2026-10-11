# Sicherheitsprüfung

Stand: 10. Oktober 2026. Geprüft wurden Oberfläche und Spielregeln, gespeicherte Daten, Offline-Worker, Karten/SVGs, Build, Abhängigkeiten, Git-Historie und GitHub-Pages-Veröffentlichung.

Bei dieser Prüfung wurde kein aktueller kritischer oder hoher Sicherheitsfehler gefunden. Spielstände werden nicht hochgeladen; es gibt keine eingebauten Tracker, fremden Skripte, Werbung oder Anfragen nach Kamera, Mikrofon und Standort. Die Prüfung ersetzt keine Garantie gegen zukünftige Fehler oder ein kompromittiertes Gerät beziehungsweise GitHub-Konto.

## Gefundene und behobene Punkte

| Punkt | Befund vor der Änderung | Änderung |
| --- | --- | --- |
| Veröffentlichung versehentlicher privater Dateien | Der Build kopierte beliebige Dateien unter `public/assets/` und `public/app/`. Dummy-`.env`-Dateien und Symlinks auf außerhalb liegende Dateien wurden tatsächlich in `dist/` übernommen. Keine echten Zugangsdaten wurden gefunden. | Nur vorgesehene Dateitypen werden übernommen. Versteckte Dateien/Ordner, Symlinks und besondere Dateitypen brechen den Build ab. Alle Quellpfade einschließlich ihrer Ordnerkomponenten innerhalb des Projekts werden geprüft. |
| Fehlende zusätzliche Browser-Schutzregel | Die HTML-Seite enthielt keine Content Security Policy. Eine aktuelle Einschleusungslücke wurde nicht gefunden; es fehlte eine zweite Schutzschicht. | CSP im HTML blockiert eingebettete Skripte, Event-Handler und `eval`, fremde Ressourcen und Verbindungen, eingebettete Webseiten, HTML-Basisadressen und Formularübertragungen. Die App lädt Skripte und Assets nur vom eigenen Origin; der optionale Einladungsdienst ist unter „Einladungslinks“ beschrieben. |
| Weitergabe der Seitenadresse | Keine allgemeine Referrer-Policy im HTML. | `no-referrer` verhindert die Weitergabe der Seitenadresse durch vom Dokument ausgelöste Ressourcen und Navigationen. Der Offline-Worker hat einen eigenen Anfragekontext und lädt ausschließlich vorgesehene lokale Dateien. |
| Veröffentlichungs-Bausteine | GitHub Actions waren an bewegliche Versions-Tags gebunden. | Alle fünf offiziellen Actions sind an überprüfte vollständige Commit-SHAs gebunden. Checkout behält keine Git-Zugangsdaten. `npm ci --ignore-scripts` unterbindet Installationsskripte; TypeScript benötigt keine. Build und Deployment behalten ihre getrennten, begrenzten Berechtigungen. |

Die CSP steht direkt nach der Zeichensatzangabe und gilt auch für die offline gespeicherte HTML-Seite. Kartenüberlappung und Ziehvorschau verwenden direkte CSSOM-Eigenschaften; dafür wird kein `unsafe-inline` freigegeben. [MDN zur CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP), [MDN zu CSS-Eigenschaften](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src), [GitHub zur Action-Absicherung](https://docs.github.com/en/actions/reference/security/secure-use).

## Daten und Vertrauensgrenzen

- Der Spielstand liegt als unverschlüsseltes JSON im Browser-Speicher unter `phase10.game.v1`. Er enthält die Partie, Karten, Phasen und Punkte. Es werden keine Kontodaten oder Zahlungsdaten erhoben. Wer Zugriff auf dieses Browserprofil hat, kann den Spielstand lesen oder verändern.
- Online lädt die App ihre eigenen Dateien und prüft auf Updates. Dabei sieht GitHub als Hosting-Anbieter technisch notwendige Verbindungsdaten, beispielsweise die IP-Adresse; der Spielstand wird dabei nicht mitgesendet. „Kein Tracking in der App“ bedeutet deshalb nicht „der Hosting-Anbieter erhält keinerlei Daten“. [GitHub-Datenschutzerklärung](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- Andere Projekte unter **dem gleichen Host `mauriceha02.github.io`** teilen im Browser den Origin-Speicher. Ein dort laufendes kompromittiertes Skript könnte Spielstände und Offline-Caches lesen oder ändern. Voraussetzung ist die Ausführung dieses Skripts im gleichen Browser-Speicherbereich. Andere Domains und GitHub-Pages-Seiten anderer Benutzer können das nicht direkt. Ein URL-Unterordner oder ein anderer Cache-Name erzeugt keine Sicherheitsgrenze; ein eigener Origin würde sie schaffen. Die Speichertrennung einer echten iPhone-Installation wurde hier nicht geprüft. [MDN zur Same-Origin-Policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy), [MDN zu CacheStorage](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage).
- Ein öffentliches Repository erlaubt Lesen und Kopieren. Änderungen an der veröffentlichten App erfordern Veröffentlichungsrechte. Das GitHub-Konto und berechtigte Mitwirkende bleiben daher Teil der Vertrauensbasis. Kontozugriff mit [Zwei-Faktor-Authentifizierung](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/about-two-factor-authentication) absichern und Schreibrechte sparsam vergeben; die aktuelle Kontoeinstellung wurde nicht geprüft.
- Der Live-Link verwendet HTTPS; HTTP wird auf HTTPS umgeleitet, HSTS ist vorhanden. Zusätzliche HTTP-Header gegen Einbetten fremder Seiten wurden beim Live-Abruf nicht geliefert. Insbesondere funktioniert `frame-ancestors` nicht in einer Meta-CSP. Die ergänzte Regel wird deshalb nicht als vollständiger Clickjacking-Schutz ausgewiesen. [MDN zu frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).
- CSP schützt zusätzlich vor Einschleusungen, kann aber einen Angreifer mit Kontrolle über veröffentlichte Dateien oder bereits kompromittierten Origin-Speicher nicht zuverlässig abwehren. Geheimnisse gehören weiterhin weder in öffentliche Quelltexte noch in Assets; Dateiendungen ersetzen keine Inhaltsprüfung.

## Prüfung und Nachweise

- `npm audit`: **0 bekannte Schwachstellen** im aktuellen Lockfile. Keine Laufzeit-Abhängigkeiten; die einzige Build-Abhängigkeit ist TypeScript 5.9.3 mit Integritätswert im Lockfile.
- Musterprüfung der **146 unterschiedlichen Git-Dateiversionen**: keine Treffer für typische private Schlüssel, Dienst-Tokens oder Zugangsdaten-URLs. Das ist keine vollständige Erkennung jedes denkbaren Geheimnisses.
- Alle **64 SVGs** geprüft: keine Skripte, Event-Handler, eingebetteten fremden Dokumente oder externen Ressourcen gefunden.
- Regressionstests prüfen externe/manipulierte Kartenpfade, feindliche Texte und IDs in gültigen Spielständen sowie versteckte Dateien, unerwartete Dateitypen und Symlinks im Veröffentlichungs-Build. Kaputte Spielstände werden abgewiesen und nicht automatisch überschrieben.
- Chrome und WebKit in mobilen Browseransichten: gezielt eingefügte Skripte, Event-Handler, `eval`, externe Skripte/Bilder/Fetch-Anfragen, Frames, Formulare, Basisadressen und eingebettete Styles werden blockiert. Die abgefangenen externen Test-Anfragen erreichten keinen fremden Server. Manipulierte Spielstandtexte bleiben Text. Keine unbeabsichtigten CSP-Verletzungen beim normalen Spiel oder Offline-Neuladen. Chrome wurde über den Offline-Modus geprüft; WebKit über einen tatsächlich ausgeschalteten lokalen Host und eine zuvor nicht geladene Navigations-URL, weil seine Offlinesimulation einen internen Browserfehler meldete.
- Karten antippen, überlappend darstellen, verschieben, abbrechen, speichern und neu laden bleiben unter der CSP funktionsfähig; Bot-Pause während des Ziehens wurde ebenfalls geprüft. Kein Test auf einem echten iPhone durchgeführt.

Die Änderungen sind zunächst lokal. Sie erreichen die installierte App erst nach Push auf `Dev`, erfolgreichem GitHub-Pages-Deployment und Aktivierung des heruntergeladenen Updates beim nächsten vollständigen Öffnen.

## Gruselino im WLAN (11. Oktober 2026)

Gruselino bindet die geprüfte Commit-ID des separaten `Game-Multiplayer`-Moduls ein. GitHub Actions holen beide festgelegten Quellstände; Netzwerkdateien werden mit der App ausgeliefert und offline gespeichert.

- Ohne Internet-Hilfe verwendet die Verbindung keine STUN-Server. Die optionale Internet-Hilfe kontaktiert Googles STUN-Dienst. Spielnachrichten laufen über einen verschlüsselten WebRTC-Datenkanal direkt zwischen den Geräten. Einladung und Antwort enthalten Verbindungsdaten und gelten zum Verbindungsaufbau 15 Minuten; die laufende Verbindung darf länger bestehen. Codes werden nicht lokal gespeichert. Einladungslinks verwenden das URL-Fragment, das die App nach dem Einlesen entfernt.
- Die Verbindung prüft Protokoll, Sitzung, Spiel, Gegenstellenrolle, Nachrichtenreihenfolge und Größe. Gruselino validiert zusätzlich Kartenlayouts und Punktstände. Der Gastgeber wertet Antworten und Eingabesperren aus; alte oder doppelte Antworten können keine weiteren Punkte vergeben.
- Der Gastgeber kontrolliert die gemeinsame Partie. Dieser private WLAN-Modus ist kein Schutz gegen absichtliches Schummeln durch einen veränderten Spielclient. Netzwerkverzögerung kann dem Gastgeber einen kleinen Vorteil geben, weil die erste bei ihm eingetroffene richtige Antwort gewinnt.
- Der WLAN-Modus schreibt keine Spielstände in den Browser-Speicher. Solopartien bleiben erhalten. Auf Kamera, Mikrofon oder Standort wird weiterhin nicht zugegriffen.

## Phase10 im WLAN (11. Oktober 2026)

Phase10 verwendet dasselbe festgelegte Verbindungsmodul. Der Gastgeber hält den vollständigen Spielstand und prüft die Aktionen beider Menschen mit den bestehenden Spielregeln.

- Zum Mitspieler werden ausschließlich seine eigene Hand, offene Karten, Phasen, Punkte, Handkartenzahlen und Stapelgrößen übertragen. Die verdeckte Hand des Gastgebers, die Nachziehreihenfolge und verdeckt gezogene Karten des Gastgebers sind nicht Teil der übertragenen Ansicht. Der Gastgeber hat als Spielleitung Zugriff auf beide Hände; dieser private Modus schützt nicht gegen einen absichtlich veränderten Gastgeber-Client.
- Aktionen sind an die Partie, deren aktuellen Stand und eine fortlaufende Nummer gebunden. Die Gegenstellenrolle bestimmt den Spieler; der Mitspieler kann keine Gastgeberrolle durch ein Nachrichtenfeld übernehmen. Doppelte, verspätete und unzulässige Züge ändern den Spielstand nicht.
- Beide Spieler verwenden dieselben Regeln für Ziehen, Abwerfen, Phasen, Anlegen, Aussetzen, Punkte und Rundenwechsel. Der Gastgeber startet die nächste Runde. Handkarten werden auf jedem Gerät unabhängig geordnet; ihre Reihenfolge wird nicht übertragen.
- Die gemeinsame Partie schreibt keine Solospielstände. Der Solo-Speicher akzeptiert weiterhin genau einen Menschen mit Computergegnern. Bei Verbindungsunterbrechung werden Spielzüge gesperrt; eine erneute Verbindung derselben offenen Sitzung synchronisiert den Stand. Schließen oder Neuladen beendet die Sitzung.

## Einladungslinks (11. Oktober 2026)

- Beide Spiele verwenden den gemeinsamen Cloudflare-Worker ausschließlich zum Austausch der WebRTC-Verbindungsdaten. Diese enthalten Netzwerkadressen. Der Dienst erhält keine Handkarten, Punkte oder Solospielstände. Spieler brauchen kein Konto; Cloudflare verarbeitet die für den Betrieb notwendigen Verbindungsdaten.
- Die CSP erlaubt für HTTP-Anfragen zusätzlich genau die beim Build überprüfte `workers.dev`-Adresse aus dem festgelegten Modulstand. Einladungslinks können die Dienstadresse nicht ändern. Skripte werden weiterhin nur lokal geladen.
- Einladungen verwenden eine zufällige Raum-ID und getrennte 128-Bit-Schlüssel für Gastgeber und Mitspieler. Die Zugangsschlüssel gehen im Authorization-Header an den Dienst; der Mitspieler-Link enthält ausschließlich den Beitrittsschlüssel im URL-Fragment. Die App entfernt das Fragment nach dem Einlesen. Wer den Link erhält, kann der Partie beitreten.
- Antworten müssen zur ursprünglichen Einladung gehören und können nur einmal hinterlegt werden. Rollenrechte, Herkunft, Anfragegröße und Anfragehäufigkeit werden geprüft. Die Herkunftsprüfung ersetzt keine Anmeldung oder Zugangsschlüssel. Daten werden nach der Übernahme der Antwort gelöscht, bei Abbruch spätestens nach 15 Minuten über einen Alarm. Worker-Logs sind deaktiviert.
- Abbruch und Verlassen stoppen laufende Anfragen und die Suche nach Antworten. Nach dem Verbindungsaufbau laufen die Spiele direkt über WebRTC weiter, auch wenn der Einladungsdienst ausfällt. Ohne Internet bleibt der Code-Modus verfügbar. Der Dienst enthält kein TURN-Relay.
