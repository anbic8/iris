# Buildplan: RunTrack – Persönliche Aktivitäten-Web-App

## Name
I.R.I.S. steht für „Improve running insight system“. 

## Technologie-Stack

| Komponente | Technologie |
|---|---|
| Backend | Python 3.12 + FastAPI |
| Datenbank | MariaDB 10.11 |
| GPX-Parsing | gpxpy |
| Container | Docker + Docker Compose |
| Frontend | HTML/CSS/JS vanilla |
| Karten | Leaflet.js + OpenStreetMap |
| Charts | Chart.js |
| WebDAV-Watcher | Python `watchdog` |

---

## Phase 1 – Fundament
> **Grobziel:** Docker-Umgebung steht, erste GPX wird geparst und landet in der DB, Login funktioniert.
> **Meilenstein:** GPX ablegen → automatisch verarbeitet → im Browser als Eintrag sichtbar nach Login.

### 1.1 Docker-Compose Setup ✅
- [x] `docker-compose.yml` mit Services: `app`, `db`, `adminer`, `backup`
- [x] Volumes für DB-Daten und GPX-Upload-Ordner
- [x] `.env`-Datei für Secrets (DB-Passwort, Secret-Key)
- [x] Health-Checks für DB-Service
- [x] `backup`-Service: täglicher `mysqldump` → `./db/backup/`, Backups älter als 7 Tage automatisch löschen

### 1.2 Datenbankschema ✅
- [x] Tabelle `users` (id, name, email, password_hash, created_at)
- [x] Tabelle `activities` (id, user_id, sport_type, start_time, duration_s, distance_m, elevation_gain_m, avg_hr, max_hr, avg_pace, gpx_file_path, created_at)
- [x] Tabelle `trackpoints` (id, activity_id, lat, lon, elevation, hr, timestamp)
- [x] Migrations-Skript `init.sql`

### 1.3 GPX-Parser Service
- [x] `gpxpy` liest Datei
- [x] Extraktion: Distanz, Dauer, Startzeit, Höhenmeter, alle Trackpoints
- [x] HR-Daten aus Polar/Garmin Extensions (`<gpxtpx:hr>`)
- [x] Sportart-Erkennung aus GPX-Metadaten (Fallback: manuell beim Upload)
- [x] Pace/Geschwindigkeit Berechnung
- [x] Schreiben in DB (activities + trackpoints)
- [x] Duplikat-Erkennung (gleiche Startzeit + Distanz → nicht zweimal importieren)
- [x] **Test: echte GPX-Datei einlesen und Ergebnis prüfen** ✅

### 1.4 Ordner-WebDAV-Watcher ✅
- [x] Jeder User hat einen eigenen upload/processed Ordner
- [x] Separater Python-Service überwacht Upload-Ordner (`watchdog`)
- [x] Neue `.gpx`-Datei → automatisch Parser aufrufen
- [x] Verarbeitete Dateien in `/processed`-Ordner verschieben
- [x] Fehler-Logging bei kaputten GPX-Dateien
- [x] **Test: GPX-Datei in inbox ablegen → automatisch verarbeitet** ✅

### 1.5 User-Authentifizierung ✅
- [x] Login-Seite (Email + Passwort)
- [x] Session-basiert
- [x] Passwort-Hashing mit `bcrypt`
- [x] Logout
- [x] Jeder User sieht nur seine eigenen Aktivitäten

---

## Phase 2 – Statistiken & Dashboard ✅
> **Grobziel:** Alle wichtigen Kennzahlen berechnet und übersichtlich dargestellt.
> **Meilenstein:** Dashboard zeigt Jahres-km, Bestzeiten, Detailseite mit Charts.

### 2.1 Aktivitätsliste ✅
- [x] Alle Aktivitäten chronologisch
- [x] Filter nach Sportart (Laufen / Radfahren / Wandern)
- [x] Filter nach Zeitraum
- [x] Sortierung (Datum, Distanz, Pace)
- [x] Kurzübersicht pro Eintrag (Datum, Distanz, Zeit, Pace, HR)

### 2.2 Jahresstatistiken ✅
- [x] Gesamt-km pro Jahr, aufgeteilt nach Sportart
- [x] Balkendiagramm: km pro Monat (Chart.js)
- [x] Vergleich Vorjahr
- [x] Anzahl Aktivitäten, Gesamthöhenmeter, Gesamtzeit

### 2.3 Bestzeiten / Personal Records ✅
- [x] Bestzeit über Standarddistanzen: 1 km, 5 km, 10 km, Halbmarathon, Marathon
- [x] Schnellste Durchschnitts-Pace pro Aktivität
- [x] Längste Aktivität (Distanz / Zeit)
- [x] Höchste Höhenmeter
- [ ] PR wird automatisch markiert wenn neue Aktivität einen Rekord bricht *(Phase 4)*

### 2.4 Einzelaktivität-Detailseite ✅
- [x] Alle Kennzahlen im Überblick
- [x] Pace-Kurve über Zeit (Chart.js)
- [x] HR-Kurve über Zeit
- [x] Höhenprofil
- [ ] HR-Zonen-Verteilung (wenn HR vorhanden) *(Phase 3.2)*

---

## Phase 3 – Karte & HR-Analyse
> **Grobziel:** Strecke auf der Karte, Herzfrequenz sinnvoll ausgewertet.
> **Meilenstein:** Aktivität auf der Karte mit HR-Farbkodierung, Zonenanalyse funktioniert.

### 3.1 Leaflet-Karte pro Aktivität
- [ ] Streckenverlauf als Polyline auf OSM
- [ ] Start/Ziel-Marker
- [ ] Hover über Strecke zeigt Pace/HR an diesem Punkt
- [ ] Farbkodierung der Strecke nach Pace oder HR (Heatmap-Style)

### 3.2 HR-Zonen-Analyse
- [ ] Konfigurierbare Maximalpuls pro User (Einstellungsseite)
- [ ] Automatische Berechnung der 5 HR-Zonen
- [ ] Zeit in jeder Zone pro Aktivität
- [ ] Donut-Chart zur Zonenverteilung

### 3.3 Höhenprofil interaktiv
- [ ] Chart.js Höhenprofil mit Hover-Tooltip
- [ ] Synchronisierung mit Karte (Hover auf Chart → Punkt auf Karte)

### 3.4 Kumulierte Karte *(nice-to-have)*
- [ ] Alle Aktivitäten eines Users auf einer Karte
- [ ] Filter nach Sportart / Zeitraum

---

## Phase 4 – Polish & Multi-User-Features
> **Grobziel:** App fühlt sich fertig an, alle 4 User können sie unabhängig nutzen.
> **Meilenstein:** Produktionsreife App, vollständig nutzbar für die Familie.

### 4.1 User-Management
- [ ] Admin-User kann neue User anlegen (kein Self-Registration)
- [ ] Profil-Seite: Name, Maximalpuls, Geburtsjahr, Gewicht (optional)
- [ ] Passwort ändern

### 4.2 Manueller Upload
- [ ] Alternativ zu WebDAV: GPX direkt im Browser hochladen
- [ ] Sportart manuell wählen falls nicht in GPX

### 4.3 UI-Polish
- [ ] Responsives Design (Mobile tauglich)
- [ ] Dark Mode
- [ ] Ladeanimationen
- [ ] Fehlermeldungen verständlich (kaputte GPX, doppelter Upload)

### 4.4 Datenqualität
- [ ] Ausreißer-Filterung bei Pace (GPS-Fehler)
- [ ] Manuelle Aktivität bearbeiten (Sportart korrigieren, Notiz hinzufügen)

### 4.5 Export
- [ ] Aktivitätsdaten als CSV exportieren
- [ ] Jahresübersicht als PDF *(optional)*

---

## Zeitschätzung (realistisch, nebenher)

| Phase | Aufwand |
|---|---|
| Phase 1 – Fundament | 6–10 Std |
| Phase 2 – Statistiken & Dashboard | 6–8 Std |
| Phase 3 – Karte & HR-Analyse | 5–8 Std |
| Phase 4 – Polish & Multi-User | 4–6 Std |
| **Gesamt** | **~21–32 Std** |

---

*Erstellt: April 2026*
