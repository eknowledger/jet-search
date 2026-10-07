---
tags: [konzept, technik, datenbank]
status: Entwurf
---

# Technisches Konzept — Speicherschicht

## Ausgangslage

Die Anwendung speichert Bestellungen bisher in einer MySQL-Datenbank aus dem Jahr 2016. Das Schema ist über die Jahre gewachsen, Indizes fehlen, und Abfragen über mehrere Jahre dauern teils über zehn Sekunden.

## Ziel

Eine Datenbankmigration auf PostgreSQL 17 ohne geplante Ausfallzeit, mit einem neuen, sauberen Schema.

## Vorgehen

1. Neues Schema anlegen und die Zugriffe im Code hinter einer Repository-Schicht kapseln.
2. Doppeltes Schreiben: Jede Änderung geht in beide Datenbanken, gelesen wird weiterhin aus MySQL.
3. Altdaten per Batch-Job übertragen und Prüfsummen pro Tabelle vergleichen.
4. Lesezugriffe schrittweise umstellen, zuerst für interne Berichte.
5. Nach zwei stabilen Wochen das doppelte Schreiben abschalten.

## Risiken

- Unterschiedliches Verhalten bei Zeitzonen und Sortierung (Collation) zwischen MySQL und PostgreSQL.
- Die Datenbankmigration fällt in die Zeit des Büroumzugs; die Lasttests müssen vorher abgeschlossen sein.

## Offene Fragen

- Brauchen wir für die Prüfsummen ein eigenes Werkzeug?
- Wer übernimmt die Rufbereitschaft in der Umstellungswoche?

Besprochen in der [[Teambesprechung KW 41]].
