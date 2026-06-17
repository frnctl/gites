# Gîtes — Dashboard de gestion (location saisonnière)

Mini-dashboard autonome pour gérer 4 appartements en location saisonnière.
**Un seul fichier** (`index.html`) : HTML + CSS + JS vanilla, aucune dépendance, aucun build.

## Les 4 appartements

| Appartement | Réf | Gestion | Annonce |
|---|---|---|---|
| RDJ | `49 RV RDJ` | Propriétaire | [Airbnb](https://www.airbnb.fr/rooms/1666841556768571133) |
| 1er étage | `RV 1er` | Propriétaire | [Airbnb](http://www.airbnb.fr/rooms/1556406620212142683) |
| Studio | — | Maria | — |
| Atelier (SST) | `SST` | Anabela | [Airbnb](https://www.airbnb.com/h/eiffeltower_headtotoe) |

## Onglets

- **Calendrier** — timeline d'occupation (4 lignes, jours du mois), barres colorées par canal. Le jour de départ ne compte pas comme nuit occupée.
- **Réservations** — tableau + formulaire (appart, canal, voyageur, dates, nuits auto, montant, statut, notes).
- **Interventions** — tableau + formulaire + filtre par appartement, totaux heures/coût.
- **Synthèse** — KPI revenu, nuits occupées, coûts/règlements + barres CSS par canal / appartement / type / mois.

## Données & sauvegarde

Les données sont stockées dans le **localStorage** du navigateur (clé `gites_v1`).
Elles restent sur l'appareil — rien n'est envoyé sur un serveur.

- **Exporter JSON** : télécharge une sauvegarde.
- **Importer JSON** : restaure une sauvegarde (remplace les données actuelles).
- **Réinitialiser** : efface tout.

> Pense à exporter régulièrement, surtout avant de vider le cache du navigateur.

## Utilisation locale

Ouvre simplement `index.html` dans un navigateur. Aucun serveur requis.

## Déploiement

Publié via **GitHub Pages** depuis la branche `main` (racine).
Le fichier `.nojekyll` désactive le traitement Jekyll.
