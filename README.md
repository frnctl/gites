# Gîtes — Cockpit de gestion (location saisonnière)

Tableau de bord autonome pour piloter 4 appartements en location saisonnière.
**Un seul fichier** (`index.html`) : HTML + CSS + JS vanilla, aucune dépendance, aucun build.

## Les 4 appartements

| Appartement | Réf | Gestion | Annonce |
|---|---|---|---|
| RDJ | `49 RV RDJ` | Propriétaire | [Airbnb](https://www.airbnb.fr/rooms/1666841556768571133) |
| 1er étage | `RV 1er` | Propriétaire | [Airbnb](https://www.airbnb.fr/rooms/1556406620212142683) |
| Studio | — | Maria | — |
| Atelier (SST) | `SST` | Anabela | [Airbnb](https://www.airbnb.com/h/eiffeltower_headtotoe) |

> Les biens sont **configurables** dans l'onglet *Biens* (ajout, renommage, couleur, lien, gestionnaire, actif/inactif).

## Onglets

- **Calendrier** — timeline d'occupation **multi-mois** (1 / 2 / 3 mois), barres colorées par canal, empilement des séjours qui se chevauchent. **Détection automatique des doubles réservations** (liseré rouge + bandeau d'alerte). Trame hachurée = séjour d'échange. Le jour de départ ne compte pas comme nuit.
- **Réservations** — formulaire (bien, canal, voyageur, nb de personnes, dates, nuits + €/nuit auto, montant, frais de ménage, échange, statut, notes), tableau triable + recherche + filtre par bien. **Import iCal `.ics`** (Airbnb/Booking) par dépôt de fichier.
- **Interventions** — suivi technique (date, intervenant, type, durée, coût, mode/statut/date de règlement, réf facture), interventions **planifiées / à faire**, recherche + filtres, totaux heures/coût.
- **Synthèse** — par année : **taux d'occupation %**, **prix moyen/nuit (ADR)**, **revenu net par appartement** (revenu − interventions), revenu vs échange, reste à régler. Graphiques par canal / type / mois. Export **CSV** (réservations, interventions) et **impression / PDF**.
- **Biens** — gestion des appartements + **annuaire des intervenants** (téléphone, email cliquables).

## Canaux

Airbnb · Booking.com · HomeExchange · SabbaticalHomes · Direct · Autre.
HomeExchange et SabbaticalHomes sont traités comme **échanges** (comptés en occupation mais **pas en chiffre d'affaires**).

## Données & sauvegarde

Stockage **localStorage** (clé `gites_v2`, cache hors-ligne), migration automatique depuis `gites_v1`.

**Synchro multi-appareils (Supabase)** — module `<script type="module">` en bas d'`index.html` :
connexion email + mot de passe, données protégées par **RLS** (chacun ne voit que les siennes),
**temps réel** iPhone ↔ ordinateur. Si pas de réseau / pas de connexion, l'app fonctionne en local.
Configuration : renseigner `SUPA = { url, key }` (clé *publishable*) et exécuter une fois
[`supabase/schema.sql`](supabase/schema.sql) dans le *SQL Editor* de Supabase.

- **Export / Import JSON** : sauvegarde / restauration complète.
- **Export CSV** : réservations et interventions (compatibles Excel FR).
- **Réinitialiser** : efface tout (onglet *Biens*).

> Tant que la synchro cloud n'est pas activée, les données restent sur **ce navigateur**. Pense à exporter régulièrement.

## Webapp iPhone

Ouvre le site dans **Safari** → *Partager* → *Sur l'écran d'accueil*. L'icône (initiales « BF » en hébreu, פב) et le mode plein écran sont configurés (`apple-touch-icon`, manifest).

## Utilisation locale

Ouvre `index.html` dans un navigateur. Aucun serveur requis.

## Déploiement

Publié via **GitHub Pages** depuis la branche `main` (racine). Le fichier `.nojekyll` désactive Jekyll.
