# G-32 — Relances clients exécutées

## Première tranche : courriel manuel, aperçu et historique

L’audit ERP indique que les règles `ar_dunning_rules` existent, mais aucun traitement ne les exécute. Cette tranche donne au comptable habilité un aperçu des factures en retard puis une action explicite d’envoi de la prochaine règle de relance par courriel.

### Périmètre

- Factures émises, partiellement réglées ou en retard avec un solde positif et une échéance atteinte.
- Une règle active par niveau, évaluée sur les jours calendaires de retard. Les règles dont l’action désigne le courriel sont envoyables. Les lettres, appels et mises en demeure restent des tâches manuelles.
- Une seule prochaine relance éligible par facture : après son envoi, la règle de courriel suivante apparaît si son seuil est atteint.
- Aperçu du destinataire, du numéro de facture, du solde dans sa devise, du nombre de jours, de la règle et du texte avant confirmation.
- Envoi SMTP configuré par l’exploitant (`QERP_SMTP_HOST`, port, identifiant, mot de passe, adresse expéditeur et mode TLS). Aucun secret SMTP dans la base ni le navigateur.
- Le corps est du texte brut issu de `ar_dunning_rules.template`. Les variables permises sont `{{customer_name}}`, `{{invoice_number}}`, `{{due_date}}`, `{{balance}}`, `{{currency}}`, `{{days_overdue}}` et `{{company_name}}`. Valeurs inconnues et HTML ne sont jamais interprétés.
- Historique par société : règle, facture, destinataire et message figés, auteur, état, dates et erreur expurgée.
- Clé idempotente unique société + facture + règle : le double clic ou une répétition HTTP ne renvoie pas un second courriel. Aucun nouvel essai automatique. Une réponse SMTP incertaine reste visible et ne peut pas être rejouée par une répétition.
- L’envoi ne comptabilise aucun frais et ne change ni le solde, ni l’état de la facture.

### Autorisations et validation

- Les aperçus et l’envoi exigent `ar.invoice`; les règles restent administrées par le droit existant `ar.settings`.
- La fonction SQL dérive la société de `auth.uid()`, contrôle facture, client, règle, seuil et absence de doublon, et fige le contenu avant la transmission.
- Les écritures d’historique passent par des fonctions contrôlées ; aucun utilisateur REST ne peut fabriquer un courriel « envoyé ».
- Si le SMTP n’est pas configuré, l’écran indique que l’envoi est indisponible et la base ne crée aucun événement.

### Hors de cette tranche

Envoi planifié, SMS, lettres PDF/postales, frais ou intérêts, envoi à des listes arbitraires, pièces jointes et déploiement d’identifiants chez un fournisseur. Ces points nécessitent leurs règles ou décisions d’exploitation propres.

### Preuve attendue

Avec un serveur SMTP de test, un compte client reçoit le courriel correspondant au prochain niveau; le journal garde le destinataire et le message exacts. Une répétition produit le même événement sans second message. Une autre société, un lecteur, une facture non échue, soldée, annulée ou un seuil non atteint sont refusés. L’absence de SMTP n’envoie rien.

### État de recette (21 novembre 2026)

- Les jumelles de migration et le contrat OpenAPI sont synchronisés; la compilation Java principale, le contrôle TypeScript et le lint ciblé passent.
- L’IT a confirmé le premier envoi au serveur SMTP factice, puis a révélé une erreur 422 lors de la répétition. Le contrôle de réclamation a été corrigé pour reconnaître aussi le composite SQL nul; la répétition reste à revalider.
- Docker Desktop est arrêté sur le poste et son service ne peut pas être ouvert ici, donc l’IT ne peut pas être relancée. L’authentification Gmail a été tentée sans envoi, mais la connexion s’est interrompue avant l’authentification. Aucun courriel réel n’a été envoyé et les identifiants restent hors du dépôt.
- V145 ajoute les RPC d’acteur appelables uniquement par `service_role`; la fonction Edge valide d’abord le JWT utilisateur et son droit `ar.invoice`, puis appelle ces RPC. La fonction gère aperçu, historique, statut, envoi manuel et sonde SMTP.
- Dans le nuage hébergé, le SMTP sortant est interdit sur 25 et 587; l’implémentation utilise TLS implicite sur le port 465. La sonde ne transmet aucun message. [Limites officielles des Edge Functions Supabase](https://supabase.com/docs/guides/functions/limits).
- État au 21 novembre 2026 : V142, V144 et V145 sont déployées dans le registre cloud. Le code de la fonction Edge et de l’écran est prêt, mais la fonction et ses secrets d’exploitation ne sont pas déployés; la recette SMTP doit confirmer l’authentification avant le premier envoi. Aucun courriel réel n’a été envoyé par cette tranche.
