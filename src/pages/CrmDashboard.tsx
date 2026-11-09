import { useMemo } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Target, TrendingUp, Trophy, ArrowRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useCrmContacts, useCrmOpportunities, useMyCrmRoles } from "@/hooks/use-crm-data";
import { CRM_STAGES, STAGE_LABELS, maskAmount, type CrmStage } from "@/lib/crm-roles";

const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

export default function CrmDashboard() {
  const perms = useMyCrmRoles();
  const { data: contacts = [] } = useCrmContacts();
  const { data: opps = [] } = useCrmOpportunities();

  const pipelineValue = opps.filter((o) => o.stage !== "won" && o.stage !== "lost").reduce((s, o) => s + Number(o.amount || 0), 0);
  const weighted = opps.filter((o) => o.stage !== "won" && o.stage !== "lost").reduce((s, o) => s + Number(o.amount || 0) * Number(o.probability || 0) / 100, 0);
  const won = opps.filter((o) => o.stage === "won");
  const closed = opps.filter((o) => o.stage === "won" || o.stage === "lost");
  const winRate = closed.length === 0 ? 0 : (won.length / closed.length) * 100;

  const byStage = useMemo(() => CRM_STAGES.map((stage) => ({
    stage: STAGE_LABELS[stage],
    count: opps.filter((o) => o.stage === stage).length,
    value: opps.filter((o) => o.stage === stage).reduce((s, o) => s + Number(o.amount || 0), 0),
  })), [opps]);

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "CRM", href: "/crm" }, { label: "Tableau de bord" }]} />
        <GuidanceBanner
          title="Tableau de bord CRM"
          description="Vue d'ensemble : contacts, pipeline, valeur pondérée, taux de conversion."
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <KpiCard icon={Users} label="Contacts" value={fmt(contacts.length)} />
          <KpiCard icon={Target} label="Pipeline ouvert" value={maskAmount(perms, pipelineValue)} />
          <KpiCard icon={TrendingUp} label="Pondéré (forecast)" value={maskAmount(perms, weighted)} />
          <KpiCard icon={Trophy} label="Taux de gain" value={`${winRate.toFixed(0)} %`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2">
            <CardHeader className="py-2"><CardTitle className="text-xs">Pipeline par étape</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byStage}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="stage" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="value" fill="hsl(var(--chart-1))" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-2"><CardTitle className="text-xs">Répartition</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {byStage.map((s) => (
                <div key={s.stage} className="flex items-center justify-between text-[11px] border-b pb-1">
                  <span>{s.stage}</span>
                  <Badge variant="outline" className="text-[10px]">{s.count}</Badge>
                </div>
              ))}
              <Button asChild size="sm" variant="outline" className="w-full h-7 text-[11px] mt-2">
                <Link to="/crm/opportunities">Pipeline complet <ArrowRight className="w-3 h-3 ml-1" /></Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

function KpiCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="w-3 h-3" /> {label}
        </div>
        <div className="text-lg font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

// re-export type to satisfy lints
export type _Stage = CrmStage;
