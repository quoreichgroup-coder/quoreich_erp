import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DocumentPrintButtons } from "@/components/DocumentDetail";
import { cn } from "@/lib/utils";
import { useMyAccess } from "@/hooks/use-my-access";
import { groupAnnexLines, useAnnexNoteLines, useAnnexNotes, useAnnexNoteTexts, type AnnexNote } from "@/hooks/use-annex-notes";
import { shiftStatementDate } from "@/lib/financial-statement-period";

/*
 * Notes annexes (V123) : chiffres calculés par la base à partir du grand livre (référentiel de rubriques en données),
 * commentaire rédigé par la société pour la date d'arrêté. Référentiel à valider par l'expert-comptable.
 */
const fmt = (n: number) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const year = new Date().getFullYear();

export function AnnexNotesPanel() {
  const notes = useAnnexNotes();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { if (!selected && notes.data?.length) setSelected(notes.data[0].code); }, [notes.data, selected]);
  const note = notes.data?.find((n) => n.code === selected) ?? null;
  return (
    <section aria-label="Notes annexes" className="space-y-3" data-testid="annex-notes">
      <div className="flex flex-wrap items-end gap-3 bg-card border border-border rounded-lg p-3">
        <div className="space-y-1"><Label className="text-xs" htmlFor="annex-from">Du</Label>
          <Input id="annex-from" type="date" className="h-8 text-xs w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs" htmlFor="annex-to">Au (date d'arrêté)</Label>
          <Input id="annex-to" type="date" className="h-8 text-xs w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <p className="text-[11px] text-muted-foreground flex-1 min-w-[240px]">Chiffres calculés sur les écritures validées ; le commentaire de chaque note est enregistré pour la date d'arrêté. Le référentiel des notes est à valider par l'expert-comptable.</p>
      </div>
      {notes.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <nav className="bg-card border border-border rounded-lg p-2 space-y-0.5" aria-label="Liste des notes">
            {(notes.data ?? []).map((n) => (
              <button key={n.code} type="button" onClick={() => setSelected(n.code)} data-testid={`annex-note-${n.code}`}
                aria-current={n.code === selected ? "true" : undefined}
                className={cn("w-full text-left text-xs px-2 py-1.5 rounded", n.code === selected ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted")}>
                Note {n.code} — {n.title}
              </button>
            ))}
          </nav>
          {note && <NoteDetail key={note.code} note={note} from={from} to={to} />}
        </div>
      )}
    </section>
  );
}

function NoteDetail({ note, from, to }: { note: AnnexNote; from: string; to: string }) {
  const lines = useAnnexNoteLines(note.kind === "text" ? null : note.code, from, to);
  const prior = useAnnexNoteLines(note.kind === "flow" ? note.code : null, shiftStatementDate(from, -1), shiftStatementDate(to, -1));
  const { query: texts, save } = useAnnexNoteTexts(to);
  const access = useMyAccess();
  const canWrite = access.data?.permissions.includes("accounting.annex") ?? false;
  const saved = texts.data?.find((t) => t.note_code === note.code)?.body ?? "";
  const [body, setBody] = useState(saved);
  useEffect(() => setBody(saved), [saved]);
  const { groups, total } = useMemo(() => groupAnnexLines(lines.data ?? []), [lines.data]);
  const priorByGroup = useMemo(() => new Map(groupAnnexLines(prior.data ?? []).groups.map((g) => [g.code, g.closing])), [prior.data]);
  const priorTotal = useMemo(() => groupAnnexLines(prior.data ?? []).total.closing, [prior.data]);
  const isBalance = note.kind === "balance";
  const title = `Note ${note.code} — ${note.title}`;

  const printable = () => ({
    title, fileName: `note-annexe-${note.code.toLowerCase()}`, amountInWords: false,
    subtitle: `Période du ${new Date(from).toLocaleDateString("fr-FR")} au ${new Date(to).toLocaleDateString("fr-FR")}`,
    header: [["Note", note.code], ["Arrêté au", new Date(to).toLocaleDateString("fr-FR")]] as [string, string][],
    columns: isBalance
      ? [{ label: "Rubrique" }, { label: "Ouverture", align: "right" as const }, { label: "Augmentations", align: "right" as const }, { label: "Diminutions", align: "right" as const }, { label: "Clôture", align: "right" as const }]
      : note.kind === "flow" ? [{ label: "Rubrique" }, { label: "Exercice", align: "right" as const }, { label: "N-1", align: "right" as const }] : [{ label: "Note" }],
    rows: note.kind === "text" ? [] : groups.map((g) => isBalance
      ? [g.label, fmt(g.opening), fmt(g.increase), fmt(g.decrease), fmt(g.closing)]
      : [g.label, fmt(g.closing), fmt(priorByGroup.get(g.code) ?? 0)]),
    footer: note.kind === "text" ? [] : [["Total", fmt(total.closing), true]] as [string, string, boolean?][],
    notes: body || null,
  });

  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-3" data-testid={`annex-detail-${note.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold flex-1">{title}</h3>
        <DocumentPrintButtons testId={`annex-print-${note.code}`} build={printable} />
      </div>
      {note.guidance && <p className="text-[11px] text-muted-foreground">{note.guidance}</p>}
      {note.kind !== "text" && (lines.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : lines.error
        ? <p className="text-xs text-destructive" role="alert">{(lines.error as Error).message}</p>
        : groups.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="annex-empty">Aucun mouvement ni solde sur les comptes de cette note pour la période.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="annex-table">
            <thead><tr className="text-muted-foreground bg-muted/30">
              <th className="text-left p-2">Rubrique / compte</th>
              {isBalance ? <><th className="text-right pr-2">Ouverture</th><th className="text-right pr-2">Augmentations</th><th className="text-right pr-2">Diminutions</th><th className="text-right pr-2">Clôture</th></>
                : <><th className="text-right pr-2">Exercice</th><th className="text-right pr-2">N-1</th></>}
            </tr></thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.code} g={g} isBalance={isBalance} prior={priorByGroup.get(g.code) ?? 0} />
              ))}
              <tr className="border-t-2 border-border font-semibold" data-testid="annex-total">
                <td className="p-2">Total</td>
                {isBalance ? <><td className="text-right pr-2 tabular-nums">{fmt(total.opening)}</td><td className="text-right pr-2 tabular-nums">{fmt(total.increase)}</td>
                  <td className="text-right pr-2 tabular-nums">{fmt(total.decrease)}</td><td className="text-right pr-2 tabular-nums">{fmt(total.closing)}</td></>
                  : <><td className="text-right pr-2 tabular-nums">{fmt(total.closing)}</td><td className="text-right pr-2 tabular-nums">{fmt(priorTotal)}</td></>}
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      <div className="space-y-1">
        <Label className="text-xs" htmlFor={`annex-text-${note.code}`}>Commentaire de la note (arrêté au {new Date(to).toLocaleDateString("fr-FR")})</Label>
        <Textarea id={`annex-text-${note.code}`} rows={note.kind === "text" ? 8 : 3} value={body} maxLength={20000}
          disabled={!canWrite} onChange={(e) => setBody(e.target.value)}
          placeholder={canWrite ? "Méthodes, événements significatifs, précisions sur les montants…" : "Rédaction réservée au droit « Rédiger les notes annexes »."} />
        {canWrite && <Button size="sm" className="h-7 text-xs" disabled={save.isPending || body === saved}
          onClick={() => save.mutate({ code: note.code, body })} data-testid={`annex-save-${note.code}`}>Enregistrer le commentaire</Button>}
      </div>
    </div>
  );
}

function GroupRows({ g, isBalance, prior }: { g: ReturnType<typeof groupAnnexLines>["groups"][number]; isBalance: boolean; prior: number }) {
  return (
    <>
      <tr className="border-t border-border bg-muted/10 font-medium" data-testid="annex-group">
        <td className="p-2">{g.label}</td>
        {isBalance ? <><td className="text-right pr-2 tabular-nums">{fmt(g.opening)}</td><td className="text-right pr-2 tabular-nums">{fmt(g.increase)}</td>
          <td className="text-right pr-2 tabular-nums">{fmt(g.decrease)}</td><td className="text-right pr-2 tabular-nums">{fmt(g.closing)}</td></>
          : <><td className="text-right pr-2 tabular-nums">{fmt(g.closing)}</td><td className="text-right pr-2 tabular-nums">{fmt(prior)}</td></>}
      </tr>
      {g.accounts.map((a) => (
        <tr key={a.account_code} className="text-muted-foreground">
          <td className="pl-6 py-1">{a.account_code} — {a.account_name}</td>
          {isBalance ? <><td className="text-right pr-2 tabular-nums">{fmt(a.opening)}</td><td className="text-right pr-2 tabular-nums">{fmt(a.increase)}</td>
            <td className="text-right pr-2 tabular-nums">{fmt(a.decrease)}</td><td className="text-right pr-2 tabular-nums">{fmt(a.closing)}</td></>
            : <><td className="text-right pr-2 tabular-nums">{fmt(a.closing)}</td><td /></>}
        </tr>
      ))}
    </>
  );
}
