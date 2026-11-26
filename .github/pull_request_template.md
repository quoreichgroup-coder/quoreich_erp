## Module et référence

<!-- Ex. : AUD-06 autorité de licences — agent « licences » -->

## Références consultées

<!-- SAP / Sage / OHADA / norme, avec liens. Ce qui a été repris et ce qui a été écarté. -->

## Ce qui change

<!-- Migrations (numéro réservé), fonctions, API, écrans. -->

## Tests exécutés

<!-- Commandes et résultats réels. « Non exécuté » si c'est le cas. -->

## Liste de revue

- [ ] Migration Flyway et jumelle Supabase au même SQL (`npm run db:check-twins`)
- [ ] Isolation des sociétés : société résolue côté serveur, nouveaux liens couverts (`install_tenant_isolation_triggers()`)
- [ ] Droits du catalogue (pas de noms de rôles), paramètres par société désactivables
- [ ] Fonctions `SECURITY DEFINER` : `search_path` figé, contrôle de droit et de société, non exécutables par `anon`
- [ ] Test d'intégration du comportement et des refus
- [ ] Écrans en français, données réelles (aucune donnée de démonstration)
- [ ] Aucun secret, aucune donnée réelle dans le dépôt
- [ ] Fichiers hors du module signalés ci-dessous

## Questions ouvertes pour le propriétaire
