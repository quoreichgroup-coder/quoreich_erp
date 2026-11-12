import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  useAccountingFrameworks,
  useAccountingSetup,
  useApplyAccountingFramework,
  useAssignPostingAccount,
  useGlAccountOptions,
} from "@/hooks/use-accounting-setup";
import { MODULE_LABELS, missingRoles } from "@/lib/accounting-setup";

/**
 * Paramétrage comptable de la société : le compte que porte chaque rôle comptable.
 *
 * Sans ce paramétrage, les comptabilisations automatiques sont refusées (QG001) : l'écran le dit
 * en clair, rôle par rôle. Seul l'administrateur de la société modifie ; les autres consultent.
 *
 * @param modules  limite l'affichage à certains modules (ex. ["AR", "TRE"] dans les réglages AR).
 */
export function PostingAccountsPanel({ modules }: { modules?: string[] }) {
  const setup = useAccountingSetup();
  const frameworks = useAccountingFrameworks();
  const accounts = useGlAccountOptions();
  const apply = useApplyAccountingFramework();
  const assign = useAssignPostingAccount();
  const [framework, setFramework] = useState("SYSCOHADA_REVISE");

  if (setup.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="posting-accounts-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Chargement du paramétrage comptable…
      </div>
    );
  }
  if (setup.isError || !setup.data) {
    return (
      <div className="bg-card border border-destructive/40 rounded-lg p-4 space-y-2" role="alert" data-testid="posting-accounts-error">
        <p className="text-sm text-destructive">Paramétrage comptable illisible : {(setup.error as Error)?.message ?? "erreur inconnue"}</p>
        <Button size="sm" variant="outline" onClick={() => setup.refetch()}>Réessayer</Button>
      </div>
    );
  }

  const data = setup.data;
  const roles = modules ? data.roles.filter((r) => modules.includes(r.module)) : data.roles;
  const missing = missingRoles({ ...data, roles });
  const activeAccounts = (accounts.data ?? []).filter((a) => a.active);

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-4" data-testid="posting-accounts-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Comptes de comptabilisation</h3>
          <p className="text-xs text-muted-foreground max-w-xl">
            Chaque comptabilisation automatique (facture, encaissement, paiement) utilise le compte associé à un rôle.
            Un rôle sans compte actif fait refuser l'opération correspondante.
          </p>
        </div>
        {data.framework ? (
          <div className="text-right space-y-1" data-testid="posting-accounts-framework">
            <p className="text-xs font-medium text-foreground">{data.framework.name}</p>
            {!data.framework.validated && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                <ShieldAlert className="w-3.5 h-3.5" /> Valeurs à faire valider par un expert-comptable local
              </p>
            )}
          </div>
        ) : null}
      </div>

      {missing.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-success" data-testid="posting-accounts-complete">
          <CheckCircle2 className="w-4 h-4" /> Paramétrage complet : aucune comptabilisation ne sera refusée pour compte manquant.
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-destructive" role="status" data-testid="posting-accounts-missing">
          <AlertTriangle className="w-4 h-4" />
          {missing.length} rôle(s) à paramétrer : {missing.map((r) => r.label).join(", ")}. Les opérations qui en dépendent seront refusées.
        </p>
      )}

      {!data.framework && (
        <div className="border border-border rounded-md p-3 space-y-2" data-testid="posting-accounts-apply">
          <p className="text-xs text-foreground">
            Aucun référentiel comptable n'est appliqué. L'appliquer crée les comptes absents du plan et associe les rôles
            non encore paramétrés ; aucun compte ni choix existant n'est modifié.
          </p>
          {data.canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="framework-select">Référentiel comptable</label>
              <select
                id="framework-select"
                value={framework}
                onChange={(e) => setFramework(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                {(frameworks.data ?? []).map((f) => (
                  <option key={f.code} value={f.code}>{f.name}</option>
                ))}
              </select>
              <Button size="sm" className="text-xs" disabled={apply.isPending} onClick={() => apply.mutate(framework)} data-testid="btn-apply-framework">
                {apply.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Appliquer le référentiel
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Seul l'administrateur de la société peut appliquer un référentiel.</p>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Module</th>
              <th className="py-2 pr-3 font-medium">Rôle comptable</th>
              <th className="py-2 pr-3 font-medium">Compte</th>
              <th className="py-2 pr-3 font-medium">Proposé</th>
              <th className="py-2 font-medium">État</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.roleCode} className="border-b border-border last:border-0 align-top" data-testid={`posting-role-${r.roleCode}`}>
                <td className="py-2 pr-3 text-muted-foreground">{MODULE_LABELS[r.module] ?? r.module}</td>
                <td className="py-2 pr-3">
                  <p className="font-medium text-foreground">{r.label}</p>
                  <p className="text-muted-foreground">{r.description}</p>
                </td>
                <td className="py-2 pr-3">
                  <label className="sr-only" htmlFor={`account-${r.roleCode}`}>Compte pour {r.label}</label>
                  <select
                    id={`account-${r.roleCode}`}
                    value={r.glAccountId ?? ""}
                    disabled={!data.canEdit || assign.isPending}
                    onChange={(e) => e.target.value && assign.mutate({ role: r.roleCode, glAccountId: e.target.value })}
                    className="h-8 w-full min-w-48 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-70"
                  >
                    <option value="">— Non paramétré —</option>
                    {/* Le compte actuel reste affiché même s'il est devenu inactif, pour que l'écart se voie. */}
                    {r.glAccountId && !activeAccounts.some((a) => a.id === r.glAccountId) && (
                      <option value={r.glAccountId}>{r.accountCode} {r.accountName} (inactif)</option>
                    )}
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{r.suggestedAccountCode ?? "—"}</td>
                <td className="py-2">
                  <StatusBadge status={r.ready ? "success" : "error"} label={r.ready ? "Prêt" : "À paramétrer"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!data.canEdit && (
        <p className="text-xs text-muted-foreground" data-testid="posting-accounts-readonly">
          Consultation seule : seul l'administrateur de la société modifie le paramétrage comptable.
        </p>
      )}
    </div>
  );
}
