import { riskLevel, type RiskSettings } from "@/lib/grc";

/* Éléments partagés des écrans risques et conformité. */

export function Kpis({ items, testId }: { items: [string, string | number, boolean?][]; testId?: string }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid={testId}>
      {items.map(([l, v, alert]) => (
        <div key={l} className="bg-card border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
          <div className={`text-lg font-semibold ${alert ? "text-destructive" : ""}`}>{v}</div>
        </div>
      ))}
    </div>
  );
}

const CELL: Record<string, string> = { low: "bg-success/15", medium: "bg-primary/15", high: "bg-warning/25", critical: "bg-destructive/25" };

/** Carte de chaleur impact (lignes, du plus fort au plus faible) × probabilité (colonnes) ; teinte = criticité selon les seuils de la société. */
export function HeatMap({ matrix, settings, title, testId }: { matrix: number[][]; settings: RiskSettings; title: string; testId?: string }) {
  const max = matrix.length;
  return (
    <div className="bg-card border border-border rounded-lg p-3" data-testid={testId}>
      <h3 className="text-xs font-semibold mb-2">{title}</h3>
      <div className="flex gap-2">
        <div className="flex flex-col justify-around text-[10px] text-muted-foreground [writing-mode:vertical-rl] rotate-180">Impact</div>
        <div className="flex-1">
          <table className="w-full text-xs border-separate border-spacing-1">
            <tbody>
              {matrix.map((row, i) => (
                <tr key={i}>
                  <th className="w-5 text-[10px] text-muted-foreground font-normal">{max - i}</th>
                  {row.map((n, j) => {
                    const lvl = riskLevel((max - i) * (j + 1), settings) ?? "low";
                    return <td key={j} className={`h-9 text-center rounded ${CELL[lvl]} ${n ? "font-semibold" : "text-muted-foreground/40"}`}
                      aria-label={`Impact ${max - i}, probabilité ${j + 1} : ${n} risque(s)`}>{n || "·"}</td>;
                  })}
                </tr>
              ))}
              <tr><th />{matrix.map((_, j) => <th key={j} className="text-[10px] text-muted-foreground font-normal">{j + 1}</th>)}</tr>
            </tbody>
          </table>
          <div className="text-center text-[10px] text-muted-foreground">Probabilité</div>
        </div>
      </div>
    </div>
  );
}

export function Score({ score, settings }: { score: number | null; settings: RiskSettings }) {
  const lvl = riskLevel(score, settings);
  if (score == null || !lvl) return <span className="text-muted-foreground">—</span>;
  const cls = { low: "text-success", medium: "text-primary", high: "text-warning", critical: "text-destructive" }[lvl];
  return <span className={`tabular-nums font-medium ${cls}`}>{score}</span>;
}
