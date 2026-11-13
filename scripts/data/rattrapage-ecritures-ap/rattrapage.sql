-- Rattrapage des factures fournisseurs approuvées SANS écriture comptable (avant V37).
--
-- SIMULATION PAR DÉFAUT : tout est fait dans une transaction annulée à la fin ; rien n'est
-- enregistré. Pour enregistrer réellement, après accord de l'expert-comptable de la société :
--
--   psql "$URL" -v appliquer=oui -f scripts/data/rattrapage-ecritures-ap/rattrapage.sql
--
-- Filtrer une société : -v societe=<uuid> (sinon toutes). Chaque écriture est datée de la facture
-- (comme V37) et passe les contrôles habituels : une période comptable close la refuse ; la
-- facture est alors signalée et laissée telle quelle, les autres sont traitées. Une facture déjà
-- payée garde ses paiements : l'écriture de facture vient seulement créditer le compte fournisseur
-- que les paiements avaient débité.
\set ON_ERROR_STOP on
\if :{?appliquer}
\else
  \set appliquer non
\endif
\if :{?societe}
\else
  \set societe ''
\endif

BEGIN;
SELECT set_config('qerp.rattrapage_societe', :'societe', true) IS NOT NULL AS parametre_lu;

CREATE TEMP TABLE rattrapage_ap (facture text, societe text, date_facture date, total numeric, resultat text) ON COMMIT DROP;

DO $$
DECLARE
  _inv public.ap_invoices%ROWTYPE;
  _filtre text := NULLIF(current_setting('qerp.rattrapage_societe'), '');
  _entry uuid;
BEGIN
  FOR _inv IN
    SELECT * FROM public.ap_invoices
     WHERE approval_status = 'approved' AND journal_entry_id IS NULL
       AND status NOT IN ('draft', 'cancelled', 'void')
       AND (_filtre IS NULL OR tenant_id = _filtre::uuid)
     ORDER BY tenant_id, invoice_date, invoice_number
  LOOP
    BEGIN
      _entry := public.ap_invoice_journal_entry(_inv);
      UPDATE public.ap_invoices SET journal_entry_id = _entry WHERE id = _inv.id;
      INSERT INTO rattrapage_ap VALUES (_inv.invoice_number, (SELECT name FROM public.tenants WHERE id = _inv.tenant_id),
                                        _inv.invoice_date, _inv.total, 'écriture créée');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO rattrapage_ap VALUES (_inv.invoice_number, (SELECT name FROM public.tenants WHERE id = _inv.tenant_id),
                                        _inv.invoice_date, _inv.total, 'REFUSÉE : ' || SQLERRM);
    END;
  END LOOP;
END $$;

SELECT societe, facture, date_facture, total, resultat FROM rattrapage_ap ORDER BY societe, date_facture, facture;
SELECT resultat ~ '^REFUS' AS refusee, count(*) AS factures, sum(total) AS montant FROM rattrapage_ap GROUP BY 1;

SELECT (:'appliquer' = 'oui') AS enregistrer \gset
SELECT CASE WHEN :'appliquer' = 'oui' THEN 'ENREGISTRÉ' ELSE 'SIMULATION : rien n''est enregistré (-v appliquer=oui pour enregistrer)' END AS mode;
\if :enregistrer
COMMIT;
\else
ROLLBACK;
\endif
