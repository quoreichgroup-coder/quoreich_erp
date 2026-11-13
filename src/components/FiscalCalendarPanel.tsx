import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronRight, History, Loader2, Lock, LockOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useMyAccess } from "@/hooks/use-my-access";
import {
  useCloseFiscalYear, useCreateFiscalYear, useFiscalCalendar, useFiscalCalendarAudit, useOpenFiscalYear, useSetPeriodStatus,
} from "@/hooks/use-fiscal-calendar";
import {
  FISCAL_YEAR_STATUS_LABELS, blockedReason, cellStatus, closingSequence, endAfterMonths, periodLabel,
  suggestNextFiscalYear, yearProgress, type FiscalPeriod, type FiscalYear,
} from "@/lib/fiscal-calendar";

const AUDIT_LABELS: Record<string, string> = {
  fiscal_year_created: "Exercice créé",
  fiscal_year_opened: "Exercice ouvert",
  fiscal_year_closed: "Exercice clôturé",
  period_closed: "Période clôturée",
  period_reopened: "Période rouverte",
};

/**
 * Exercices et périodes : le seul endroit où se décident les clôtures (calendrier fiscal de
 * Sage 300, OB52 de SAP). Une ligne par période, une colonne par module ; la base applique l'ordre
 * de clôture, le motif de réouverture et l'interdiction de saisir hors d'un exercice ouvert.
 */
export function FiscalCalendarPanel() {
  const calendar = useFiscalCalendar();
  const access = useMyAccess();
  const canClose = access.data?.permissions.includes("periods.close") ?? false;
  const canReopen = access.data?.permissions.includes("periods.reopen") ?? false;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const years = calendar.data?.years ?? [];
  useEffect(() => {
    if (expanded === null && years.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      setExpanded((years.find((y) => y.start_date <= today && today <= y.end_date) ?? years.at(-1))!.id);
    }
  }, [years, expanded]);

  if (calendar.isLoading) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Chargement du calendrier fiscal…</p>;
  }
  if (calendar.isError || !calendar.data) {
    return (
      <div className="bg-card border border-destructive/40 rounded-lg p-4 space-y-2" role="alert">
        <p className="text-sm text-destructive">Calendrier fiscal illisible : {(calendar.error as Error)?.message ?? "erreur inconnue"}</p>
        <Button size="sm" variant="outline" onClick={() => calendar.refetch()}>Réessayer</Button>
      </div>
    );
  }
  const { periods, modules, locks } = calendar.data;

  return (
    <div className="space-y-4" data-testid="fiscal-calendar-panel">
      <div className="bg-card border border-border rounded-lg p-5 space-y-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> Exercices et périodes</h3>
        <p className="text-xs text-muted-foreground max-w-3xl">
          Un exercice dure douze mois et suit l'année civile par défaut (SYSCOHADA, AUDCIF art. 7) ; seul le premier peut être plus
          court ou plus long, et commencer un autre mois. Chaque période se clôture module par module : les modules opérationnels
          d'abord, le Grand livre en dernier. Rouvrir demande un motif et commence par le Grand livre. Une fois clôturé, un exercice
          ne se rouvre plus.
        </p>
        {years.length === 0 && (
          <p className="text-xs text-foreground bg-muted/50 rounded px-3 py-2" data-testid="fiscal-no-year">
            Aucun exercice défini : seules les clôtures de période s'appliquent. Créez le premier exercice pour que la base refuse
            toute saisie hors d'un exercice ouvert.
          </p>
        )}
        {!canClose && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />
            Consultation seule : la gestion des exercices et des clôtures demande le droit « Clôturer une période ».</p>
        )}
      </div>

      {canClose && <NewFiscalYear years={years} />}

      <div className="bg-card border border-border rounded-lg divide-y divide-border">
        {years.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">Aucun exercice.</p>}
        {[...years].reverse().map((fy) => {
          const fyPeriods = periods.filter((p) => p.fiscal_year_id === fy.id);
          const progress = yearProgress(fyPeriods, locks, modules);
          const open = expanded === fy.id;
          return (
            <div key={fy.id} data-testid={`fiscal-year-${fy.code}`}>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button className="flex items-center gap-2 text-left flex-1 min-w-[220px]" onClick={() => setExpanded(open ? null : fy.id)}
                  aria-expanded={open}>
                  {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                  <span className="text-xs font-semibold text-foreground">Exercice {fy.code}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(fy.start_date).toLocaleDateString("fr-FR")} → {new Date(fy.end_date).toLocaleDateString("fr-FR")} · {fyPeriods.length} périodes
                  </span>
                </button>
                <span className="text-[11px] text-muted-foreground tabular-nums">{progress.closed}/{progress.total} clôtures</span>
                <span className={cn("text-[11px] px-2 py-0.5 rounded font-medium",
                  fy.status === "open" ? "bg-success/15 text-success" : fy.status === "closed" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                  {FISCAL_YEAR_STATUS_LABELS[fy.status]}
                </span>
                {canClose && <YearActions fy={fy} complete={progress.total > 0 && progress.closed === progress.total} />}
              </div>
              {open && (
                <PeriodGrid fy={fy} periods={fyPeriods} canClose={canClose} canReopen={canReopen} calendar={calendar.data} />
              )}
            </div>
          );
        })}
      </div>

      {(canClose || canReopen) && (
        <div>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={() => setShowAudit(!showAudit)}>
            <History className="w-3.5 h-3.5" /> {showAudit ? "Masquer le journal" : "Journal des clôtures"}
          </Button>
          {showAudit && <AuditTable modules={modules} />}
        </div>
      )}
    </div>
  );
}

function NewFiscalYear({ years }: { years: FiscalYear[] }) {
  const create = useCreateFiscalYear();
  const suggestion = suggestNextFiscalYear(years);
  const first = years.length === 0;
  const [start, setStart] = useState(suggestion.start.slice(0, 7));
  const [months, setMonths] = useState(12);
  useEffect(() => { setStart(suggestion.start.slice(0, 7)); }, [suggestion.start]);
  const startDate = `${start}-01`;
  const end = endAfterMonths(startDate, first ? months : 12);

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-wrap items-end gap-3" data-testid="fiscal-new-year">
      <label className="text-xs space-y-1">
        <span className="block text-muted-foreground">Début</span>
        <Input type="month" value={start} disabled={!first} onChange={(e) => setStart(e.target.value)} className="h-9 w-40" />
      </label>
      <label className="text-xs space-y-1">
        <span className="block text-muted-foreground">Durée (mois)</span>
        <Input type="number" min={1} max={18} value={first ? months : 12} disabled={!first} className="h-9 w-24"
          onChange={(e) => setMonths(Math.max(1, Math.min(18, Number(e.target.value) || 12)))} />
      </label>
      <p className="text-xs text-muted-foreground pb-2">
        Fin : {new Date(end).toLocaleDateString("fr-FR")}
        {first ? " — premier exercice : 1 à 18 mois, n'importe quel mois de début." : " — à la suite du dernier exercice, 12 mois."}
      </p>
      <Button size="sm" className="gap-1" disabled={create.isPending || !start} onClick={() => create.mutate({ start: startDate, end })}
        data-testid="fiscal-create-year">
        {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Créer l'exercice
      </Button>
    </div>
  );
}

function YearActions({ fy, complete }: { fy: FiscalYear; complete: boolean }) {
  const openFy = useOpenFiscalYear();
  const closeFy = useCloseFiscalYear();
  if (fy.status === "not_open") {
    return <Button size="sm" variant="outline" className="h-7 text-xs" disabled={openFy.isPending}
      onClick={() => openFy.mutate(fy.id)} data-testid={`fiscal-open-${fy.code}`}>Ouvrir</Button>;
  }
  if (fy.status === "open") {
    return <Button size="sm" variant="outline" className="h-7 text-xs" disabled={closeFy.isPending || !complete}
      title={complete ? "Clôture définitive de l'exercice" : "Toutes les périodes de tous les modules doivent être clôturées"}
      onClick={() => {
        if (window.confirm(`Clôturer définitivement l'exercice ${fy.code} ? Il ne pourra plus être rouvert.`)) closeFy.mutate(fy.id);
      }} data-testid={`fiscal-close-${fy.code}`}>Clôturer l'exercice</Button>;
  }
  return null;
}

function PeriodGrid({ fy, periods, canClose, canReopen, calendar }: {
  fy: FiscalYear; periods: FiscalPeriod[]; canClose: boolean; canReopen: boolean;
  calendar: NonNullable<ReturnType<typeof useFiscalCalendar>["data"]>;
}) {
  const { modules, locks } = calendar;
  const setStatus = useSetPeriodStatus();
  const [reopen, setReopen] = useState<{ period: string; module: string } | null>(null);
  const [closingAll, setClosingAll] = useState<string | null>(null);
  const editable = fy.status === "open";

  const closeAll = async (period: string) => {
    setClosingAll(period);
    try {
      for (const m of closingSequence(locks, modules, period)) {
        await setStatus.mutateAsync({ period, module: m.code, status: "closed" });
      }
    } catch {
      /* le message de la base est déjà affiché ; on s'arrête au premier refus */
    } finally {
      setClosingAll(null);
    }
  };

  return (
    <div className="px-4 pb-4 overflow-x-auto" data-testid={`fiscal-grid-${fy.code}`}>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-medium py-2 pr-3 sticky left-0 bg-card">Période</th>
            {modules.map((m) => <th key={m.code} className={cn("font-medium px-1.5 py-2 text-center whitespace-nowrap", m.is_ledger && "text-foreground")}>{m.label}</th>)}
            {editable && canClose && <th className="px-1.5" />}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => {
            const remaining = closingSequence(locks, modules, p.code);
            return (
              <tr key={p.code} className="border-t border-border">
                <td className="py-1.5 pr-3 whitespace-nowrap sticky left-0 bg-card">
                  <span className="text-muted-foreground tabular-nums mr-2">P{p.period_no}</span>
                  <span className="text-foreground">{periodLabel(p.code)}</span>
                </td>
                {modules.map((m) => {
                  const status = cellStatus(locks, p.code, m.code);
                  const target = status === "closed" ? "open" : "closed";
                  const blocked = blockedReason(locks, modules, p.code, m.code, target);
                  const allowed = editable && (target === "closed" ? canClose : canReopen) && !blocked;
                  const lock = locks.find((l) => l.period === p.code && l.module === m.code);
                  return (
                    <td key={m.code} className="px-1 py-1 text-center">
                      <button
                        type="button"
                        disabled={!allowed || setStatus.isPending}
                        onClick={() => (target === "open" ? setReopen({ period: p.code, module: m.code })
                          : setStatus.mutate({ period: p.code, module: m.code, status: "closed" }))}
                        title={[
                          `${m.label} — ${periodLabel(p.code)} : ${status === "closed" ? "clôturée" : "ouverte"}`,
                          lock?.reason ? `Motif : ${lock.reason}` : "",
                          !editable ? `Exercice ${FISCAL_YEAR_STATUS_LABELS[fy.status].toLowerCase()}` : blocked ?? "",
                        ].filter(Boolean).join("\n")}
                        aria-label={`${m.label} ${periodLabel(p.code)} : ${status === "closed" ? "clôturée, rouvrir" : "ouverte, clôturer"}`}
                        data-testid={`fiscal-cell-${p.code}-${m.code}`}
                        className={cn("inline-flex items-center justify-center w-8 h-7 rounded border transition-colors",
                          status === "closed" ? "bg-muted border-border text-muted-foreground" : "bg-card border-border text-success",
                          allowed && "hover:border-primary hover:text-primary", !allowed && "opacity-60 cursor-not-allowed")}>
                        {status === "closed" ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  );
                })}
                {editable && canClose && (
                  <td className="px-1.5 text-right whitespace-nowrap">
                    {remaining.length === 0 ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><Check className="w-3 h-3" /> Clôturée</span>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={closingAll !== null || setStatus.isPending}
                        onClick={() => closeAll(p.code)} data-testid={`fiscal-close-all-${p.code}`}>
                        {closingAll === p.code ? <Loader2 className="w-3 h-3 animate-spin" /> : "Clôturer la période"}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-muted-foreground flex flex-wrap gap-3">
        <span className="inline-flex items-center gap-1"><LockOpen className="w-3 h-3 text-success" /> Ouverte</span>
        <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Clôturée</span>
        <span>« Clôturer la période » clôture les modules dans l'ordre et s'arrête au premier refus de la base (brouillons, rapprochements…).</span>
      </p>
      <ReopenDialog target={reopen} modules={modules} onClose={() => setReopen(null)}
        onConfirm={(reason) => {
          if (!reopen) return;
          setStatus.mutate({ ...reopen, status: "open", reason }, { onSuccess: () => setReopen(null) });
        }} pending={setStatus.isPending} />
    </div>
  );
}

function ReopenDialog({ target, modules, onClose, onConfirm, pending }: {
  target: { period: string; module: string } | null; modules: { code: string; label: string }[];
  onClose: () => void; onConfirm: (reason: string) => void; pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (target) setReason(""); }, [target]);
  const label = modules.find((m) => m.code === target?.module)?.label ?? target?.module;
  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent onOpenAutoFocus={(e) => { e.preventDefault(); ref.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>Rouvrir {label} — {target ? periodLabel(target.period) : ""}</DialogTitle>
          <DialogDescription>Le motif est enregistré au journal des clôtures avec votre nom.</DialogDescription>
        </DialogHeader>
        <Textarea ref={ref} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
          placeholder="Ex. : écriture de régularisation oubliée" aria-label="Motif de réouverture" data-testid="fiscal-reopen-reason" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button disabled={!reason.trim() || pending} onClick={() => onConfirm(reason.trim())} data-testid="fiscal-reopen-confirm">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Rouvrir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuditTable({ modules }: { modules: { code: string; label: string }[] }) {
  const audit = useFiscalCalendarAudit(true);
  const label = useMemo(() => new Map(modules.map((m) => [m.code, m.label])), [modules]);
  if (audit.isLoading) return <p className="text-sm text-muted-foreground mt-2">Chargement du journal…</p>;
  if (audit.isError) return <p className="text-sm text-destructive mt-2" role="alert">Journal illisible : {(audit.error as Error)?.message}</p>;
  const rows = audit.data ?? [];
  return (
    <div className="mt-2 bg-card border border-border rounded-lg overflow-x-auto" data-testid="fiscal-audit">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 px-4 font-medium">Date</th><th className="py-2 px-4 font-medium">Changement</th>
            <th className="py-2 px-4 font-medium">Exercice / période</th><th className="py-2 px-4 font-medium">Module</th>
            <th className="py-2 px-4 font-medium">Motif</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="py-4 px-4 text-muted-foreground">Aucun changement enregistré.</td></tr>}
          {rows.map((r) => (
            <tr key={r.seq} className="border-b border-border last:border-0">
              <td className="py-2 px-4 tabular-nums text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString("fr-FR")}</td>
              <td className="py-2 px-4">{AUDIT_LABELS[r.action] ?? r.action}</td>
              <td className="py-2 px-4">{r.period ? periodLabel(r.period) : r.fiscal_year_code ?? ""}</td>
              <td className="py-2 px-4">{r.module ? label.get(r.module) ?? r.module : ""}</td>
              <td className="py-2 px-4 text-muted-foreground">{r.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
