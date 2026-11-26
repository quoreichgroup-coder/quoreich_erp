# QERP — Language Management Center (LMC)

Évaluation demandée par le cahier i18n §12. Recommandation : **pas de LMC au MVP** ; un LMC de société en
« Commercial Stable » ; un LMC plateforme complet en « Enterprise » (D-I18N-008).

## 1. Emplacement

Conforme au standard de présentation : `/settings?tab=languages` (« Langues et formats ») pour la société,
cohérent avec la centralisation de la configuration dans `/settings`. Le LMC plateforme (catalogues globaux)
relève de l'équipe produit et vit dans le dépôt (fichiers JSON revus par pull request), pas dans l'application
d'un client.

## 2. Fonctions par palier

| Fonction | MVP | Commercial Stable | Enterprise |
|---|---|---|---|
| Activer les langues de la société, langue / locale / fuseau par défaut | Oui (onglet simple) | Oui | Oui |
| Préférence utilisateur | Oui (profil) | Oui | Oui |
| Recherche, filtres, consultation des clés | — | Oui | Oui |
| Édition des traductions de référentiels société | — | Oui | Oui |
| Surcharge société de libellés globaux | — | Oui (hors clés réservées) | Oui |
| Import / export JSON, CSV, Excel (`readTableFile`, `exportToXLSX` existants) | — | Oui | Oui |
| Détection des clés manquantes / inutilisées | CI seulement | CI + écran de couverture | Oui |
| Versions, historique, prévisualisation, publication, rollback | — | Publication + historique | Complet |
| Circuit Draft → In Review → Approved → Published | — | Oui (configurable, désactivable) | Oui |
| Indicateurs de couverture par langue et module | CI | Oui | Oui |
| Assistant de traduction IA | — | — | Oui (validation humaine obligatoire) |

## 3. Droits (catalogue, pas de rôle en dur)

| Droit | Usage | Attribué par défaut à |
|---|---|---|
| `i18n.settings` | langues actives, défauts société | admin |
| `i18n.translate` | créer / modifier des traductions société (brouillon) | admin |
| `i18n.review` | passer en revue, approuver | admin |
| `i18n.publish` | publier, revenir en arrière | admin |

Rôles du cahier (System Administrator, Tenant Administrator, Translator, Translation Reviewer) : le premier est
l'équipe produit (dépôt) ; les trois autres sont des **rôles personnalisés** construits avec ces droits dans
l'éditeur « Rôles et autorisations » existant. Séparation des tâches paramétrable : `i18n_settings.review_second_person`
(par défaut vrai), comme `chart_import_settings.require_second_person` (V65).

## 4. Règles de priorité

`surcharge société publiée` > `traduction globale livrée` > `langue source fr` > `clé`.
Une surcharge non publiée n'est visible qu'en prévisualisation.

## 5. Import

- Format standard = export de l'écran (même principe que l'import du plan comptable, V68) : détection automatique
  des colonnes, l'utilisateur n'intervient qu'en cas d'échec.
- Contrôles : clé connue, langue active, variables `{{x}}` identiques à la source, longueur maximale, aucun HTML.
- Tout ou rien, anomalies listées (comme `import_chart_mapping_lines`, V69).

## 6. Audit

Chaque changement d'état est journalisé (avant / après, auteur, motif), lecture par l'admin société.

## Note de consolidation — 26 novembre 2026, après-midi

- Le droit s'appelle `languages.settings` (le catalogue refuse les chiffres dans le préfixe de module : `i18n.*`
  est impossible). Les futurs droits du LMC suivront : `languages.translate`, `languages.review`, `languages.publish`.
- MVP livré par le PoC : onglet `/settings?tab=languages` visible de tout membre (préférences personnelles) ; la
  partie société n'apparaît qu'avec `languages.settings` (ou admin) et la route `/api/v1/languages` est protégée par
  `module-access.json`. Le français source ne peut pas être retiré.
