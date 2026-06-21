# Notifications WhatsApp vers Bruno — mode d'emploi

Bruno reçoit un message WhatsApp à **chaque action** d'une concierge
(🧹 ménage, 🧺 linge, 🔑 check-in), avec le bien, qui a fait quoi, la date,
l'heure et le prochain client. Service utilisé : **CallMeBot** (gratuit).

## 1. Obtenir la clé CallMeBot (une fois, ~2 min)

Sur le **téléphone de Bruno** (celui qui doit recevoir les notifs) :

1. Ajouter le contact **+34 644 51 95 23** (le bot CallMeBot).
2. Lui envoyer le message WhatsApp :
   **`I allow callmebot to send me messages`**
3. Le bot répond avec ta clé : **`Your APIKEY is 123456`** → note ce nombre.

> Si le bot ne répond pas tout de suite, réessaie quelques minutes après.
> Doc officielle : https://www.callmebot.com/blog/free-api-whatsapp-messages/

## 2. Renseigner dans l'app (Bruno / admin)

1. Onglet **Biens** → panneau **« 🔔 Notifications WhatsApp (Bruno) »**.
2. **N° WhatsApp** : `+33695710501` (format international, avec `+33`).
3. **Clé API** : le nombre reçu à l'étape 1.
4. Coche **« Activer les notifications »** → **Enregistrer**.
5. Clique **« Envoyer un test »** → Bruno doit recevoir un WhatsApp. ✅

## 3. C'est tout

Dès qu'une concierge appuie sur **Ménage fait / Linge fait / Check-in OK**,
Bruno reçoit le message. Les réglages sont synchronisés : pas besoin de les
refaire sur chaque appareil.

## Bon à savoir

- CallMeBot n'envoie qu'au **numéro de Bruno** (celui qui a autorisé le bot).
- Pour stopper : décoche « Activer les notifications ».
- Service gratuit « au mieux » : convient parfaitement à un usage perso. Si un
  jour tu veux du 100 % garanti, on pourra passer à une Edge Function + un
  fournisseur pro (Twilio / WhatsApp Cloud API).
