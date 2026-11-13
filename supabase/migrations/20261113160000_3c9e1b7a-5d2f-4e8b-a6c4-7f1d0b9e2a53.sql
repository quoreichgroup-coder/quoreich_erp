-- V28 — Ordre certain dans le journal des autorisations. Écrit à la main.
--
-- erp_authorization_audit (V25) se triait par created_at, qui vaut now() : l'heure de début de
-- la TRANSACTION. Tous les événements d'une même opération (créer un rôle en copiant ses droits,
-- remplacer la liste des droits) portaient donc la même heure, et leur ordre affiché dépendait
-- de l'uuid — constaté sur la copie réelle : des « droit retiré » listés avant la création du
-- rôle. Un journal d'audit doit restituer l'ordre exact des faits.
--
-- seq : numéro d'ordre attribué par la base à l'insertion, croissant, jamais modifiable
-- (GENERATED ALWAYS). Les lignes déjà présentes reçoivent un numéro dans un ordre arbitraire :
-- pour elles, l'ordre à l'intérieur d'une même transaction restait de toute façon inconnu.
-- Une colonne d'identité ne demande aucun droit sur sa séquence à qui insère.
--
-- Jumelle : services/api/src/main/resources/db/migration/V28__ordre_du_journal_des_autorisations.sql

ALTER TABLE public.erp_authorization_audit
  ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.erp_authorization_audit
  ADD CONSTRAINT erp_authorization_audit_seq_key UNIQUE (seq);

DROP INDEX public.erp_authorization_audit_tenant_idx;
CREATE INDEX erp_authorization_audit_tenant_idx ON public.erp_authorization_audit (tenant_id, seq DESC);
