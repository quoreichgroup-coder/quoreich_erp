-- Retour arrière NON destructif de V155 (C-03, AC10). À appliquer comme migration corrective (V156+),
-- jamais en réécrivant V155. Rien n'est supprimé : ni préférence, ni traduction, ni édition.
--
-- Effet : l'anglais redevient inactif ; toute préférence 'en' (utilisateur, société, client) est
-- simplement ignorée par la résolution (repli sur le français source) et redevient effective si l'on
-- réactive la langue. Les éditions déjà émises en anglais gardent leurs octets, leur langue et leurs
-- empreintes ; seule une NOUVELLE émission en anglais est refusée (QG039), jamais produite en français
-- à l'insu de l'utilisateur.
--
-- Simulation par défaut : psql -v appliquer=true pour valider (booléen psql : true / on / 1).
\set ON_ERROR_STOP on
\if :{?appliquer}
\else
  \set appliquer false
\endif
BEGIN;
UPDATE public.languages SET is_active = false WHERE code = 'en' AND NOT is_source;
SELECT code, is_active, is_source FROM public.languages ORDER BY sort_order;
SELECT count(*) AS preferences_conservees FROM public.profiles WHERE language = 'en';
\if :appliquer
COMMIT;
\else
ROLLBACK;
\echo 'Simulation : rien n''a été modifié (psql -v appliquer=true pour valider).'
\endif
