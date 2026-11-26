# 30 — Lot 6 : modèles versionnés et éditions archivées

Suite de l'audit au 20 novembre 2026. Référence : cahier des charges v1.1, DOC-TPL-01 à DOC-TPL-06 et DEC-06.
Le propriétaire demande de continuer les implémentations. Première tranche : facture client ; les autres pièces du
chapitre 24 suivront avec le même circuit. Le lot 6 complet ne sera déclaré terminé qu'après leur raccordement.

## Existant vérifié

- `DocumentDetail` produit les PDF dans le navigateur via `document-pdf.ts`. Une nouvelle impression relit les données.
- `report_templates` conserve des configurations de rapports ; ce ne sont pas des versions de documents publiées.
- V138 apporte les pièces jointes, mais pas la preuve d'une édition : version du modèle et instantané des données.
- Aucun service Gotenberg ni transport de messagerie sortante n'est présent dans `infra/`.
- La charte charge actuellement Montserrat et Playfair Display depuis Google Fonts : le rendu isolé doit embarquer les polices.

## Tranche D1 — facture client archivée

1. Modèles de documents distincts des configurations de rapports. Un enregistrement crée une version ; une publication
   la rend immuable. Auteur, date, motif et SHA-256 sont conservés. Édition et publication : droit `reports.templates`.
2. Éditeur à composants verrouillés : titre, introduction, pied, couleur et taille de texte ; champs autorisés insérables.
   Le serveur génère le HTML depuis ces valeurs structurées et échappe tout texte. Aucun HTML/CSS libre, expression,
   script, URL, cadre ou ressource distante fourni par la société n'est exécuté. Aperçu dans une iframe sans scripts.
3. Émission réservée aux factures clients émises, avec le droit `ar.invoice`. Données lues côté serveur, y compris devise
   et montants de la facture, identité de la société, tiers, lignes, taxes et échéance. L'instantané JSON et son empreinte
   sont figés avec la version publiée du modèle.
4. Une demande répétée reprend l'édition existante, même si le modèle ou la fiche du tiers a changé. Un remplacement
   explicite et motivé crée une nouvelle référence et conserve l'édition précédente.
5. Travail de rendu borné et séparé du traitement HTTP. Gotenberg 9.2 est le moteur retenu par DEC-06 ; JavaScript,
   téléchargements et accès sortants sont interdits ; réseau Docker interne, délais, corps et file d'attente limités.
   Polices de marque embarquées, sortie PDF/A. Erreur visible et relance explicite avec le même instantané.
6. PDF conservé une seule fois : fichier sur site, compartiment privé `issued-documents` dans Supabase. Le PDF servi
   est celui conservé ; pas de nouvelle conversion pour réimprimer. Empreinte du PDF, moteur et version enregistrés.
   Le chemin est construit par le serveur, sans réécriture d'un fichier existant ; une altération est signalée.
7. Accès par société et par les permissions existantes. Liens nuage signés pour 60 secondes. Pas d'écriture directe
   des modèles publiés, des états de rendu ou des archives par un utilisateur REST.

## Interfaces de la tranche

- `document_templates` : identité du modèle, société, type `ar_invoice`, nom et version courante.
- `document_template_versions` : version, présentation structurée, HTML généré, empreinte, publication et motif.
- `issued_documents` : facture, version, contexte et empreinte, référence d'édition, remplacement, état
  `queued / rendering / ready / failed`, chemin, empreinte PDF, moteur/version et dates.
- RPC publiques : `save_document_template`, `publish_document_template`, `request_document_edition`, `retry_document_edition`.
- RPC de service uniquement : `claim_document_edition`, `complete_document_edition`, `fail_document_edition` ; l'acteur
  vérifié est transmis explicitement et son droit et sa société sont revérifiés.
- API Java : `/api/v1/document-templates`, `/api/v1/document-editions`, et téléchargement de l'archive.
- Nuage : fonction `document-render`, qui vérifie le jeton utilisateur, appelle les mêmes RPC, rend et archive côté serveur.

## Recette

Version 1 publiée → émission → version 2 publiée et identité du tiers modifiée → réimpression : même identifiant et mêmes
octets PDF. Remplacement explicite : nouvelle référence, lien vers la précédente et nouvelle preuve. Autres cas :
lecteur ne publiant pas, isolation inter-sociétés, double demande concurrente, instantané en devise, contenu malveillant
neutralisé, panne de rendu puis relance, archive altérée refusée, polices incorporées et absence de réseau sortant.

## Après D1

Raccorder demandes et commandes d'achat, réceptions, sorties, factures fournisseurs et clôture de trésorerie ; étendre
les composants de présentation et les actifs de marque. La mise en service du rendu nuage nécessite un hôte joignable
pour le service de conversion ; sa préparation et ses tests locaux font partie de D1.


## Mise à jour — 21 novembre 2026

- Les commandes d'achat sont raccordées au circuit commun : modèles `standard` et `reference-PO0004821`, versions publiées,
  instantané immuable, droits `procurement.order` et `reports.templates`, PDF conservé et remplacement motivé.
- La migration V143 est appliquée par Flyway sur PostgreSQL local (`qerp_reel`) et par sa jumelle SQL sur le projet Supabase
  propriétaire `ymomubgdhufwtbsqqnas`. Les deux modèles sont installés pour ROXGOLD SANGO dans les deux environnements.
- Les champs fabricant, expédition, livraison et contact acheteur restent vides quand la source ne les fournit pas. Les taxes
  sont indiquées non calculées ; le total respecte la devise du bon de commande.
- L'API sur site et le moteur Gotenberg privé sont démarrés localement. Le rendu Supabase attend le déploiement de la fonction
  Edge, un secret `QERP_PDF_URL` et une URL Gotenberg HTTPS joignable depuis le nuage.
- L'ancien projet Lovable référencé par `.env` retourne encore PGRST205. Le projet propriétaire corrigé est dans `.env.cloud`
  et se lance avec `npm run dev:cloud`.
