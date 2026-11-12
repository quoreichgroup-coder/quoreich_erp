-- Contre-passation des écritures en double. ÉCRIT — à exécuter via corriger.psql.
--
-- Prérequis : 01-constat.sql exécuté dans la même session (vue temporaire), et
-- V16 appliquée (sinon de nouveaux doublons apparaissent à chaque paiement).
--
-- Méthode : la RPC officielle reverse_journal_entry, pas un traitement maison.
-- Elle crée une écriture inverse datée du jour, passe le doublon en 'reversed',
-- et passe par les mêmes déclencheurs que n'importe quelle contre-passation :
-- équilibre DR=CR, verrou de période, piste d'audit. Rien n'est supprimé.
--
-- L'acteur enregistré est l'auteur de l'écriture d'origine (la RPC lit
-- auth.uid() pour la société et pour created_by) : la correction reste
-- attribuée dans la société concernée, jamais à un compte technique.
--
-- Idempotent : un doublon déjà 'reversed' n'est plus sélectionné.
-- Tout ou rien : la moindre erreur annule l'ensemble.
DO $$
DECLARE
  r record;
  bloques int;
  faites int := 0;
BEGIN
  SELECT count(*) INTO bloques
  FROM qerp_doublons_ecritures d
  JOIN public.period_locks p
    ON p.tenant_id = d.tenant_id AND p.module = 'GL' AND p.status = 'closed'
   AND p.period = to_char(d.entry_date, 'YYYY-MM')
  WHERE d.rang > 1 AND d.status = 'posted';

  IF bloques > 0 THEN
    RAISE EXCEPTION
      '% écriture(s) en double dans une période GL close : une réouverture autorisée est requise. Rien n''a été modifié.',
      bloques USING ERRCODE = '23514';
  END IF;

  FOR r IN
    SELECT id, created_by FROM qerp_doublons_ecritures
    WHERE rang > 1 AND status = 'posted'
    ORDER BY tenant_id, entry_number, id
  LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', r.created_by, 'role', 'authenticated')::text, true);
    PERFORM public.reverse_journal_entry(
      r.id, CURRENT_DATE, 'Doublon de déclencheur sur payments (corrigé par V16)');
    faites := faites + 1;
  END LOOP;

  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE 'contre-passations créées : %', faites;
END $$;
