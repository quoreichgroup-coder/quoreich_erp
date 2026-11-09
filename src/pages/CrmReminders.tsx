import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { useCrmReminders, useCompleteActivity, useMyCrmRoles } from "@/hooks/use-crm-data";
import { actionTooltip } from "@/lib/crm-roles";

type Bucket = "todo" | "overdue" | "done";

export default function CrmReminders() {
  const perms = useMyCrmRoles();
  const { data: items = [], isLoading } = useCrmReminders();
  const complete = useCompleteActivity();
  const [tab, setTab] = useState<Bucket>("todo");

  const buckets = useMemo(() => {
    const now = Date.now();
    const todo: typeof items = [];
    const overdue: typeof items = [];
    const done: typeof items = [];
    for (const a of items) {
      if (a.completed_at) { done.push(a); continue; }
      const due = a.due_at ? new Date(a.due_at).getTime() : 0;
      if (due && due < now) overdue.push(a);
      else todo.push(a);
    }
    return { todo, overdue, done };
  }, [items]);

  function renderTable(rows: typeof items) {
    if (isLoading) return <div className="text-xs text-muted-foreground py-6 text-center">Chargement…</div>;
    if (rows.length === 0) return <div className="text-xs text-muted-foreground py-6 text-center">Aucun rappel.</div>;
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-[11px]">Échéance</TableHead>
            <TableHead className="text-[11px]">Sujet</TableHead>
            <TableHead className="text-[11px]">Type</TableHead>
            <TableHead className="text-[11px]">Assigné</TableHead>
            <TableHead className="text-[11px]">Statut</TableHead>
            <TableHead className="text-[11px] w-32"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => {
            const due = a.due_at ? new Date(a.due_at) : null;
            const isOverdue = due && !a.completed_at && due.getTime() < Date.now();
            return (
              <TableRow key={a.id} className="text-xs">
                <TableCell className="font-mono text-[10px]">
                  {due ? due.toLocaleString("fr-FR") : "—"}
                </TableCell>
                <TableCell>{a.subject}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{a.type}</Badge></TableCell>
                <TableCell className="font-mono text-[10px]">
                  {a.assigned_to ? `${a.assigned_to.slice(0, 8)}…` : "—"}
                </TableCell>
                <TableCell>
                  {a.completed_at ? (
                    <Badge className="text-[10px] bg-success">Terminé</Badge>
                  ) : isOverdue ? (
                    <Badge variant="destructive" className="text-[10px]">En retard</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">À faire</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {!a.completed_at && (
                    <Button
                      size="sm" variant="outline" className="h-7 text-[10px]"
                      disabled={!perms.canEdit || complete.isPending}
                      title={actionTooltip(perms, "edit", "Marquer terminé")}
                      onClick={() => complete.mutate(a.id)}
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Terminé
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  return (
    <PageShell>
      <div className="space-y-3">
        <Breadcrumb items={[{ label: "CRM", href: "/crm" }, { label: "Rappels" }]} />
        <GuidanceBanner
          title="Rappels d'activités"
          description="Suivez vos rappels d'activités CRM par état. Une activité avec une échéance dépassée est marquée en retard."
        />

        <div className="grid grid-cols-3 gap-2">
          <KpiCard icon={<Clock className="w-4 h-4 text-blue-500" />} label="À faire" value={buckets.todo.length} />
          <KpiCard icon={<AlertTriangle className="w-4 h-4 text-destructive" />} label="En retard" value={buckets.overdue.length} />
          <KpiCard icon={<CheckCircle2 className="w-4 h-4 text-success" />} label="Terminés" value={buckets.done.length} />
        </div>

        <Card>
          <CardContent className="p-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as Bucket)}>
              <TabsList>
                <TabsTrigger value="todo" className="text-xs">À faire ({buckets.todo.length})</TabsTrigger>
                <TabsTrigger value="overdue" className="text-xs">En retard ({buckets.overdue.length})</TabsTrigger>
                <TabsTrigger value="done" className="text-xs">Terminés ({buckets.done.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="todo" className="mt-3">{renderTable(buckets.todo)}</TabsContent>
              <TabsContent value="overdue" className="mt-3">{renderTable(buckets.overdue)}</TabsContent>
              <TabsContent value="done" className="mt-3">{renderTable(buckets.done)}</TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}
