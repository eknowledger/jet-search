---
tags: [conception, technique]
statut: brouillon
---

# Conception — cache des miniatures

## Contexte

La galerie affiche jusqu'à 2 000 images par dossier. Aujourd'hui, chaque miniature est recalculée à l'ouverture, ce qui bloque l'interface plusieurs secondes sur les gros dossiers.

## Proposition

- Générer les miniatures dans un worker, jamais sur le thread principal.
- Les stocker dans IndexedDB, avec pour clé le chemin du fichier et sa date de modification.
- Garder en mémoire un cache LRU des 300 dernières miniatures affichées.

## Invalidation

Quand un fichier change, sa date de modification change aussi : l'ancienne entrée n'est plus jamais lue et sera purgée au prochain nettoyage. Un nettoyage complet tourne au démarrage si la base dépasse 200 Mo.

## Points ouverts

- Faut-il générer deux tailles (liste et grille) ou une seule ?
- Que faire des images de plus de 50 Mo ? Proposition : pas de miniature, une icône générique.

## Mesures attendues

Ouverture d'un dossier de 2 000 images en moins de 300 ms une fois le cache chaud.

Présenté en [[Réunion d'équipe]] le 5 octobre.
