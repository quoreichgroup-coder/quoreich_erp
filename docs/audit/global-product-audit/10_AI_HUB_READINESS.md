# 10 — Préparation du Business AI Hub

> Phase 4. Échange « Créer un agent IA ERP » **non fourni** ; l'audit porte sur ce qui existe dans le code.

## 1. Existant

| Élément | Constat | Preuve |
|---|---|---|
| Analyses | 2 : prévision de trésorerie, détection d'anomalies d'écritures | `supabase/functions/ai-cashflow-forecast`, `ai-gl-anomaly-detection` ; `AiController` (sur site) |
| Fournisseur | Configurable par secrets (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`) dans le nuage ; `QERP_AI_*` sur site ; absent = 503 explicite | `supabase/functions/_shared/ai-provider.ts` |
| Planification | Analyses planifiées (jour / semaine / mois), exécutées sous l'identité et la RLS de l'auteur | V117, `AiScheduler`, `PilotageAdminApiIT.analysePlanifiee` |
| Historique | `ai_analysis_history` : insertion seule, signée par l'auteur, jamais modifiée | V116 |
| Agents, outils, orchestration, mémoire, recherche documentaire | **Aucun** | — |

## 2. Niveau de maturité IA

Niveau constaté : **assistance analytique ponctuelle** (l'IA lit un extrait et produit un texte ; elle n'agit sur rien).
Pas d'agent, pas d'appel d'outils, pas de validation humaine structurée d'une action proposée. **PARTIAL.**

## 3. Gouvernance — écarts

| # | Écart | Gravité |
|---|---|---|
| IA-1 | **Données envoyées en clair au fournisseur externe** : jusqu'à 150 écritures récentes (montants, libellés, tiers) sérialisées dans l'invite, sans minimisation ni masquage | **Élevée** (confidentialité financière, données personnelles possibles dans les libellés) |
| IA-2 | **Aucun paramètre société pour activer / désactiver l'IA** ni consentement (recherche sans résultat, EV-23) ; contraire à la règle « tout paramétrable » du projet | Élevée |
| IA-3 | Pas de registre des modèles, versions, invites ni de traçabilité des coûts | Moyenne |
| IA-4 | Pas d'évaluation de la qualité des résultats (faux positifs des anomalies, erreur de prévision) | Moyenne |
| IA-5 | Pas de garde-fou contre l'injection d'invite via des libellés saisis | Moyenne (impact limité tant que l'IA n'agit pas) |

## 4. Prérequis d'un hub d'agents

1. Gouvernance d'abord : activation par société et par usage (droit du catalogue), minimisation des données, choix du
   fournisseur et de sa localisation, journal complet (invite, modèle, coût, résultat).
2. Couche d'outils : exposer aux agents les **fonctions existantes** (elles portent déjà droits, société et séparation des
   tâches) plutôt que de l'accès SQL ; toute action passe par l'utilisateur qui l'approuve.
3. Premiers agents à forte valeur et faible risque : lecture (questions sur la balance, le retard client, le budget),
   préparation de brouillons (écriture, facture, demande d'achat) validés par l'humain.
4. Évaluation : jeux de questions de référence par module avant toute mise en production.
