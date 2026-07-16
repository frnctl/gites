# Notifications — architecture v4

L'ancienne intégration CallMeBot côté navigateur est retirée.

Une application multi-utilisateur ne doit jamais placer une clé de notification
dans le navigateur ou dans une ligne lisible par les concierges. Les futures
notifications seront envoyées par une fonction serveur avec :

- secret conservé dans Sanctum et dans l'environnement serveur ;
- consentement et préférences par organisation ;
- déduplication ;
- journal d'envoi ;
- reprise sur erreur ;
- alerte technique envoyée à l'opérateur, pas au propriétaire.

En attendant cette fonction serveur, les actions métier restent enregistrées et
visibles instantanément dans le cockpit.
