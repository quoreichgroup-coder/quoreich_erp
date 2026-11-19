import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, GitBranch, ShieldCheck } from "lucide-react";
import { useWorkflowRules } from "@/hooks/use-workflow-data";

/*
 * Onglets de /settings qui renvoient aux écrans réels (ils montraient des données de démonstration) : le plan
 * comptable, les circuits d'approbation et les journaux d'audit se gèrent là où la base les applique.
 */

function Item({ to, title, text }: { to: string; title: string; text: string }) {
  return (
    <Link to={to} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/30 border-b border-border/50 last:border-0">
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{text}</div>
      </div>
      <ArrowRight className="w-4 h-4 text-primary shrink-0 mt-0.5" />
    </Link>
  );
}

function Card({ icon: Icon, title, intro, children, testId }: { icon: typeof BookOpen; title: string; intro: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden max-w-4xl" data-testid={testId}>
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5"><Icon className="w-4 h-4" /> {title}</h3>
        <p className="text-xs text-muted-foreground mt-1">{intro}</p>
      </div>
      {children}
    </div>
  );
}

export function ChartOfAccountsHub() {
  return (
    <Card icon={BookOpen} title="Plan comptable" testId="settings-chart-hub"
      intro="Le plan comptable de la société, ses contrôles de qualité, l'import et les référentiels se gèrent dans la comptabilité générale.">
      <Item to="/journal/master-data" title="Comptes de la société" text="Créer, modifier, désactiver ; contrôle du plan ; export et import" />
      <Item to="/journal/charts" title="Référentiels et règles de qualité" text="SYSCOHADA, PCG, correspondances, migration du plan" />
      <Item to="/settings?tab=posting" title="Comptabilisation" text="Comptes utilisés par les écritures automatiques et jeux de comptes" />
    </Card>
  );
}

export function ApprovalCircuitsHub() {
  const { data: rules = [] } = useWorkflowRules();
  return (
    <Card icon={GitBranch} title="Circuits d'approbation" testId="settings-workflow-hub"
      intro="Chaque module applique ses propres niveaux d'approbation, vérifiés par la base (jamais par l'auteur, dans l'ordre des niveaux).">
      <Item to="/procurement/settings" title="Achats" text="Seuils et niveaux des demandes et commandes" />
      <Item to="/payables/settings" title="Comptes fournisseurs" text="Seuils et niveaux des factures fournisseurs" />
      <Item to="/expenses/settings" title="Notes de frais" text="Seuils et niveaux des notes de frais" />
      <Item to="/budget/settings?tab=approval" title="Budget" text="Approbation et révisions des budgets" />
      <Item to="/hr/settings" title="Paie et RH" text="Approbation des cycles de paie et des mouvements" />
      {rules.length > 0 && (
        <div className="px-4 py-3 bg-muted/20">
          <div className="text-xs font-medium text-foreground mb-1">Règles de circuit enregistrées ({rules.length})</div>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {rules.map((r) => <li key={r.id}>{r.name} · {r.module} · {r.is_active ? "active" : "inactive"}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function AuditJournalsHub() {
  return (
    <Card icon={ShieldCheck} title="Audit et journaux" testId="settings-audit-hub"
      intro="Les journaux sont écrits par la base à chaque opération et ne peuvent être ni modifiés ni effacés.">
      <Item to="/journal/control" title="Grand livre" text="Piste d'audit des écritures, anomalies, intégrité, rapprochement des comptes auxiliaires" />
      <Item to="/settings?tab=roles" title="Rôles et autorisations" text="Journal des rôles, droits et affectations (onglet « Journal »)" />
      <Item to="/settings?tab=fiscal" title="Exercices et périodes" text="Journal des ouvertures et clôtures" />
      <Item to="/treasury/control" title="Trésorerie" text="Piste d'audit des comptes et mouvements, limites, rapprochements" />
      <Item to="/procurement/control" title="Achats" text="Approbations, rapprochements, délais" />
      <Item to="/hr/control" title="RH et paie" text="Journal des mouvements et des cycles" />
      <Item to="/compliance" title="Conformité et risques" text="Tests de contrôles, constats, évaluations des risques" />
    </Card>
  );
}
