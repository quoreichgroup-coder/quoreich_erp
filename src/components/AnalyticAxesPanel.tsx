import { useMemo, useState } from "react";
import { AlertTriangle, Layers, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import {
  useAnalyticsSetup, useCreateAnalyticAxis, useCreateAnalyticValue, useDeleteAnalyticRule,
  useSetAnalyticRule, useUpdateAnalyticAxis, useUpdateAnalyticValue,
} from "@/hooks/use-analytics-setup";
import {
  ACCOUNT_PREFIX, AXIS_CODE, REQUIREMENT_LABELS, requirementsFor, valueTree,
  type AnalyticAxis, type AnalyticsSetup,
} from "@/lib/analytics-setup";

/**
 * Paramétrage analytique : axes (Département, Centre de coûts, Projet…), leurs sections, et les
 * règles qui rendent un axe obligatoire ou interdit sur une plage de comptes.
 *
 * Les règles sont appliquées par la base au moment de comptabiliser (refus QG002) ; l'aperçu
 * « Tester un compte » montre à l'avance ce qu'une écriture devra porter.
 */
export function AnalyticAxesPanel() {
  const setup = useAnalyticsSetup();
  const [selected, setSelected] = useState<string | null>(null);

  if (setup.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="analytics-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Chargement de l'analytique…
      </div>
    );
  }
  if (setup.isError || !setup.data) {
    return (
      <div className="bg-card border border-destructive/40 rounded-lg p-4 space-y-2" role="alert" data-testid="analytics-error">
        <p className="text-sm text-destructive">Analytique illisible : {(setup.error as Error)?.message ?? "erreur inconnue"}</p>
        <Button size="sm" variant="outline" onClick={() => setup.refetch()}>Réessayer</Button>
      </div>
    );
  }

  const data = setup.data;
  const axis = data.axes.find((a) => a.id === selected) ?? data.axes[0];

  return (
    <div className="space-y-4" data-testid="analytics-panel">
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Layers className="w-4 h-4" /> Axes analytiques</h3>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Un axe ventile les écritures en dehors du plan de comptes : département, centre de coûts, projet, site…
            Chaque axe a ses sections ; des règles le rendent obligatoire ou interdit selon le compte.
          </p>
        </div>

        {data.axes.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="analytics-empty">
            Aucun axe défini : aucune écriture ne demande d'imputation analytique.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Axes analytiques">
            {data.axes.map((a) => (
              <button
                key={a.id}
                role="tab"
                aria-selected={a.id === axis?.id}
                onClick={() => setSelected(a.id)}
                data-testid={`axis-tab-${a.code}`}
                className={cn(
                  "px-3 py-1.5 rounded-md border text-xs font-medium transition-colors",
                  a.id === axis?.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {a.name} <span className="font-mono opacity-70">{a.code}</span>
                {!a.active && <span className="ml-1.5 text-muted-foreground">(inactif)</span>}
              </button>
            ))}
          </div>
        )}

        {data.canManageAxes ? <NewAxisForm nextOrder={data.axes.length + 1} /> : (
          <p className="text-xs text-muted-foreground" data-testid="analytics-axes-readonly">Seul l'administrateur de la société crée des axes et des règles.</p>
        )}
      </div>

      {axis && <AxisDetail key={axis.id} axis={axis} setup={data} />}
      {data.axes.length > 0 && <AccountPreview setup={data} />}
    </div>
  );
}

function NewAxisForm({ nextOrder }: { nextOrder: number }) {
  const create = useCreateAnalyticAxis();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const codeOk = AXIS_CODE.test(code);
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!codeOk || !name.trim()) return;
        create.mutate({ code, name, sortOrder: nextOrder }, { onSuccess: () => { setCode(""); setName(""); } });
      }}
    >
      <label className="text-xs space-y-1">
        <span className="text-muted-foreground">Code</span>
        <Input id="new-axis-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DEPT" className="h-8 w-32 font-mono text-xs" />
      </label>
      <label className="text-xs space-y-1">
        <span className="text-muted-foreground">Nom</span>
        <Input id="new-axis-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Département" className="h-8 w-48 text-xs" />
      </label>
      <Button type="submit" size="sm" className="text-xs gap-1" disabled={!codeOk || !name.trim() || create.isPending} data-testid="btn-create-axis">
        <Plus className="w-3.5 h-3.5" /> Créer l'axe
      </Button>
      {code && !codeOk && <p className="text-xs text-destructive w-full">Code : majuscules, chiffres et _, en commençant par une lettre.</p>}
    </form>
  );
}

function AxisDetail({ axis, setup }: { axis: AnalyticAxis; setup: AnalyticsSetup }) {
  const updateAxis = useUpdateAnalyticAxis();
  const updateValue = useUpdateAnalyticValue();
  const tree = useMemo(() => valueTree(axis.values), [axis.values]);

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-5" data-testid={`axis-detail-${axis.code}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">{axis.name} <span className="font-mono text-xs text-muted-foreground">{axis.code}</span></h4>
        {setup.canManageAxes && (
          <Button
            size="sm" variant="outline" className="text-xs"
            disabled={updateAxis.isPending}
            onClick={() => updateAxis.mutate({ id: axis.id, name: axis.name, sortOrder: axis.sortOrder, active: !axis.active })}
            data-testid="btn-toggle-axis"
          >
            {axis.active ? "Désactiver l'axe" : "Réactiver l'axe"}
          </Button>
        )}
      </div>
      {!axis.active && (
        <p className="text-xs text-muted-foreground">Axe inactif : il n'est ni contrôlé ni imputé sur les nouvelles écritures.</p>
      )}

      <section className="space-y-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sections</h5>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Code</th>
                <th className="py-2 pr-3 font-medium">Libellé</th>
                <th className="py-2 pr-3 font-medium">Validité</th>
                <th className="py-2 pr-3 font-medium">État</th>
                <th className="py-2 font-medium"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {tree.length === 0 && (
                <tr><td colSpan={5} className="py-3 text-muted-foreground">Aucune section sur cet axe.</td></tr>
              )}
              {tree.map(({ value, depth }) => (
                <tr key={value.id} className="border-b border-border last:border-0" data-testid={`value-row-${value.code}`}>
                  <td className="py-2 pr-3 font-mono" style={{ paddingLeft: `${depth * 16}px` }}>{depth > 0 && "└ "}{value.code}</td>
                  <td className="py-2 pr-3 text-foreground">{value.name}</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {value.validFrom || value.validTo ? `${value.validFrom ?? "…"} → ${value.validTo ?? "…"}` : "Permanente"}
                  </td>
                  <td className="py-2 pr-3"><StatusBadge status={value.active ? "success" : "info"} label={value.active ? "Active" : "Inactive"} /></td>
                  <td className="py-2 text-right">
                    {setup.canManageValues && (
                      <Button
                        size="sm" variant="ghost" className="h-7 text-xs"
                        disabled={updateValue.isPending}
                        onClick={() => updateValue.mutate({ id: value.id, name: value.name, parentId: value.parentId, validFrom: value.validFrom, validTo: value.validTo, active: !value.active })}
                      >
                        {value.active ? "Désactiver" : "Réactiver"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {setup.canManageValues ? <NewValueForm axis={axis} /> : (
          <p className="text-xs text-muted-foreground">Seuls l'administrateur et le comptable gèrent les sections.</p>
        )}
      </section>

      <section className="space-y-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Règles par compte</h5>
        <RulesEditor axis={axis} canEdit={setup.canManageAxes} />
      </section>
    </div>
  );
}

function NewValueForm({ axis }: { axis: AnalyticAxis }) {
  const create = useCreateAnalyticValue();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const datesOk = !validFrom || !validTo || validFrom <= validTo;
  const ok = code.trim() && name.trim() && datesOk;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      data-testid="new-value-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        create.mutate({ axisId: axis.id, code, name, parentId, validFrom, validTo }, {
          onSuccess: () => { setCode(""); setName(""); setParentId(""); setValidFrom(""); setValidTo(""); },
        });
      }}
    >
      <label className="text-xs space-y-1"><span className="text-muted-foreground">Code</span>
        <Input id="new-value-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="COM" className="h-8 w-28 font-mono text-xs" /></label>
      <label className="text-xs space-y-1"><span className="text-muted-foreground">Libellé</span>
        <Input id="new-value-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Commercial" className="h-8 w-44 text-xs" /></label>
      <label className="text-xs space-y-1"><span className="text-muted-foreground">Parent</span>
        <select id="new-value-parent" value={parentId} onChange={(e) => setParentId(e.target.value)} className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs">
          <option value="">— Aucun —</option>
          {axis.values.map((v) => <option key={v.id} value={v.id}>{v.code} {v.name}</option>)}
        </select></label>
      <label className="text-xs space-y-1"><span className="text-muted-foreground">Valide du</span>
        <Input id="new-value-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="h-8 w-36 text-xs" /></label>
      <label className="text-xs space-y-1"><span className="text-muted-foreground">au</span>
        <Input id="new-value-to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className="h-8 w-36 text-xs" /></label>
      <Button type="submit" size="sm" className="text-xs gap-1" disabled={!ok || create.isPending} data-testid="btn-create-value">
        <Plus className="w-3.5 h-3.5" /> Ajouter
      </Button>
      {!datesOk && <p className="text-xs text-destructive w-full">La date de début doit précéder la date de fin.</p>}
    </form>
  );
}

function RulesEditor({ axis, canEdit }: { axis: AnalyticAxis; canEdit: boolean }) {
  const setRule = useSetAnalyticRule();
  const deleteRule = useDeleteAnalyticRule();
  const [prefix, setPrefix] = useState("");
  const [requirement, setRequirement] = useState<"required" | "forbidden">("required");
  const prefixOk = ACCOUNT_PREFIX.test(prefix);
  return (
    <div className="space-y-2">
      {axis.rules.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="rules-empty">Aucune règle : l'axe est facultatif sur tous les comptes.</p>
      ) : (
        <ul className="space-y-1">
          {axis.rules.map((r) => (
            <li key={r.accountPrefix} className="flex items-center gap-3 text-xs" data-testid={`rule-${r.accountPrefix}`}>
              <span className="font-mono w-24">Comptes {r.accountPrefix}…</span>
              <StatusBadge status={r.requirement === "required" ? "warning" : "error"} label={REQUIREMENT_LABELS[r.requirement]} />
              {canEdit && (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" aria-label={`Retirer la règle ${r.accountPrefix}`}
                  onClick={() => deleteRule.mutate({ axisId: axis.id, prefix: r.accountPrefix })}>
                  <Trash2 className="w-3.5 h-3.5" /> Retirer
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form className="flex flex-wrap items-end gap-2" data-testid="new-rule-form"
          onSubmit={(e) => { e.preventDefault(); if (prefixOk) setRule.mutate({ axisId: axis.id, prefix, requirement }, { onSuccess: () => setPrefix("") }); }}>
          <label className="text-xs space-y-1"><span className="text-muted-foreground">Comptes commençant par</span>
            <Input id="new-rule-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ""))} placeholder="6" inputMode="numeric" className="h-8 w-28 font-mono text-xs" /></label>
          <label className="text-xs space-y-1"><span className="text-muted-foreground">L'axe y est</span>
            <select id="new-rule-requirement" value={requirement} onChange={(e) => setRequirement(e.target.value as "required" | "forbidden")} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              <option value="required">Obligatoire</option>
              <option value="forbidden">Interdit</option>
            </select></label>
          <Button type="submit" size="sm" className="text-xs" disabled={!prefixOk || setRule.isPending} data-testid="btn-set-rule">Enregistrer la règle</Button>
        </form>
      )}
      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Une règle « obligatoire » s'applique aux écritures manuelles, aux factures clients et aux encaissements. Les comptabilisations
        fournisseurs, stock, paie et immobilisations n'en tiennent pas encore compte.
      </p>
    </div>
  );
}

function AccountPreview({ setup }: { setup: AnalyticsSetup }) {
  const [account, setAccount] = useState("701");
  const result = requirementsFor(setup, account);
  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-3" data-testid="analytics-preview">
      <h4 className="text-sm font-semibold text-foreground">Tester un compte</h4>
      <label className="text-xs space-y-1 block"><span className="text-muted-foreground">Numéro de compte</span>
        <Input id="preview-account" value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="h-8 w-32 font-mono text-xs" /></label>
      {result.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucun axe actif.</p>
      ) : (
        <ul className="space-y-1">
          {result.map(({ axis, requirement, rule }) => (
            <li key={axis.id} className="flex flex-wrap items-center gap-2 text-xs" data-testid={`preview-${axis.code}`}>
              <span className="w-40 text-foreground">{axis.name}</span>
              <StatusBadge status={requirement === "required" ? "warning" : requirement === "forbidden" ? "error" : "info"} label={REQUIREMENT_LABELS[requirement]} />
              <span className="text-muted-foreground">{rule ? `règle « comptes ${rule.accountPrefix}… »` : "aucune règle"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
