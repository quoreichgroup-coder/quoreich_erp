import { useEffect, useMemo, useState } from "react";
import { Copy, History, KeyRound, Loader2, Lock, MailPlus, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import {
  useAssignRole, useAuthorizationAudit, useAuthorizations, useCreateRole, useDeleteRole,
  useRevokeRole, useSetRolePermissions, useUpdateRole,
} from "@/hooks/use-authorizations";
import { AUDIT_LABELS, MODULE_LABELS, catalogByModule, isLastAdmin, type Authorizations, type Role } from "@/lib/authorizations";
import { useCreateInvitation, useInvitations, useRevokeInvitation } from "@/hooks/use-invitations";
import { INVITATION_STATUS_LABELS, invitationStatus, sortInvitations } from "@/lib/invitations";

type Tab = "roles" | "users" | "invitations" | "audit";

/**
 * Rôles et autorisations de la société : le seul endroit où se décident les droits. La base les
 * applique à chaque opération (has_permission, has_role) et journalise chaque changement.
 * Rôles système : en lecture seule (on les copie pour les adapter). Rôles sur mesure : droits
 * cochés dans le catalogue. Seul l'administrateur modifie.
 */
export function AuthorizationsPanel() {
  const query = useAuthorizations();
  const [tab, setTab] = useState<Tab>("roles");

  if (query.isLoading) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Chargement des autorisations…</p>;
  }
  if (query.isError || !query.data) {
    return (
      <div className="bg-card border border-destructive/40 rounded-lg p-4 space-y-2" role="alert">
        <p className="text-sm text-destructive">Autorisations illisibles : {(query.error as Error)?.message ?? "erreur inconnue"}</p>
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>Réessayer</Button>
      </div>
    );
  }
  const view = query.data;
  const tabs: { id: Tab; label: string; icon: typeof KeyRound }[] = [
    { id: "roles", label: "Rôles", icon: KeyRound },
    { id: "users", label: "Utilisateurs", icon: Users },
    ...(view.canManage ? [
      { id: "invitations" as Tab, label: "Invitations", icon: MailPlus },
      { id: "audit" as Tab, label: "Journal", icon: History },
    ] : []),
  ];

  return (
    <div className="space-y-4" data-testid="authorizations-panel">
      <div className="bg-card border border-border rounded-lg p-5 space-y-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Rôles et autorisations</h3>
        <p className="text-xs text-muted-foreground max-w-3xl">
          Un rôle est un ensemble de droits du catalogue. Les rôles système, en lecture seule, reprennent les rôles de chaque module ;
          pour en adapter un, créez un rôle sur mesure en le copiant. Chaque droit est vérifié par la base à chaque opération, et
          chaque changement est journalisé.
        </p>
        {!view.canManage && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5" data-testid="authorizations-readonly">
            <Lock className="w-3.5 h-3.5" /> Consultation seule : seul l'administrateur de la société modifie les rôles.
          </p>
        )}
      </div>

      <div className="flex gap-1 border-b border-border" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`authz-tab-${t.id}`}
            className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {tab === "roles" && <RolesTab view={view} />}
      {tab === "users" && <UsersTab view={view} />}
      {tab === "invitations" && view.canManage && <InvitationsTab view={view} />}
      {tab === "audit" && view.canManage && <AuditTab />}
    </div>
  );
}

function RolesTab({ view }: { view: Authorizations }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = view.roles.find((r) => r.id === selectedId) ?? view.roles.find((r) => !r.system) ?? view.roles[0];
  const custom = view.roles.filter((r) => !r.system);
  const system = view.roles.filter((r) => r.system);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] gap-4">
      <div className="bg-card border border-border rounded-lg p-3 space-y-3 lg:max-h-[36rem] lg:overflow-y-auto" data-testid="roles-list">
        <RoleGroup title="Rôles sur mesure" roles={custom} selectedId={selected?.id} onSelect={setSelectedId}
          empty="Aucun rôle sur mesure." />
        <RoleGroup title="Rôles système" roles={system} selectedId={selected?.id} onSelect={setSelectedId} />
      </div>
      <div className="space-y-4 min-w-0">
        {selected && <RoleDetail key={selected.id} role={selected} view={view} onDeleted={() => setSelectedId(null)} />}
        {view.canManage && <NewRoleForm view={view} onCreated={setSelectedId} />}
      </div>
    </div>
  );
}

function RoleGroup({ title, roles, selectedId, onSelect, empty }: {
  title: string; roles: Role[]; selectedId?: string; onSelect: (id: string) => void; empty?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1">{title}</p>
      {roles.length === 0 && empty && <p className="text-xs text-muted-foreground px-1">{empty}</p>}
      {roles.map((r) => (
        <button key={r.id} onClick={() => onSelect(r.id)} data-testid={`role-item-${r.code ?? r.name}`}
          className={cn("w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center justify-between gap-2",
            r.id === selectedId ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground")}>
          <span className="truncate">{r.name}{r.needsReview && <span className="ml-1 text-destructive">· à revoir</span>}</span>
          <span className="text-muted-foreground tabular-nums shrink-0">{r.memberCount}</span>
        </button>
      ))}
    </div>
  );
}

function RoleDetail({ role, view, onDeleted }: { role: Role; view: Authorizations; onDeleted: () => void }) {
  const update = useUpdateRole();
  const setPerms = useSetRolePermissions();
  const remove = useDeleteRole();
  const editable = view.canManage && !role.system;
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [checked, setChecked] = useState<Set<string>>(new Set(role.permissions));
  useEffect(() => setChecked(new Set(role.permissions)), [role.permissions]);
  const dirty = checked.size !== role.permissions.length || role.permissions.some((p) => !checked.has(p));
  const groups = useMemo(() => catalogByModule(view.catalog), [view.catalog]);
  const toggle = (code: string) => setChecked((c) => { const n = new Set(c); if (n.has(code)) n.delete(code); else n.add(code); return n; });

  return (
    <div className="bg-card border border-border rounded-lg p-5 space-y-4" data-testid="role-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{role.name}</h4>
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge status="info" label={role.system ? "Rôle système" : "Rôle sur mesure"} />
            {role.needsReview && <StatusBadge status="error" label="À revoir : sans effet" />}
            <StatusBadge status="info" label={`${role.memberCount} utilisateur(s)`} />
          </div>
          {role.description && <p className="text-xs text-muted-foreground">{role.description}</p>}
        </div>
        {editable && (
          <Button size="sm" variant="ghost" className="text-xs gap-1 text-destructive" data-testid="btn-delete-role"
            disabled={role.memberCount > 0 || remove.isPending}
            title={role.memberCount > 0 ? "Retirez d'abord ce rôle à ses utilisateurs" : undefined}
            onClick={() => remove.mutate(role.id, { onSuccess: onDeleted })}>
            <Trash2 className="w-3.5 h-3.5" /> Supprimer
          </Button>
        )}
      </div>

      {role.needsReview && (
        <p className="text-xs text-destructive" role="status" data-testid="role-needs-review">
          Rôle repris de l'ancienne matrice, dont les droits n'ont jamais rien protégé. Il ne donne aucun droit tant qu'il n'est pas
          activé : vérifiez ses droits ci-dessous, puis activez-le.
        </p>
      )}

      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs space-y-1"><span className="text-muted-foreground">Nom</span>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-52 text-xs" /></label>
          <label className="text-xs space-y-1"><span className="text-muted-foreground">Description</span>
            <Input id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} className="h-8 w-64 text-xs" /></label>
          <Button size="sm" variant="outline" className="text-xs" disabled={!name.trim() || update.isPending}
            onClick={() => update.mutate({ id: role.id, name, description, active: false })}>Enregistrer</Button>
          {role.needsReview && (
            <Button size="sm" className="text-xs" data-testid="btn-activate-role" disabled={update.isPending}
              onClick={() => update.mutate({ id: role.id, name, description, active: true })}>Activer le rôle</Button>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Droits ({checked.size})</h5>
          {editable && dirty && (
            <Button size="sm" className="text-xs" data-testid="btn-save-permissions" disabled={setPerms.isPending}
              onClick={() => setPerms.mutate({ id: role.id, permissions: [...checked], current: role.permissions })}>
              Enregistrer les droits
            </Button>
          )}
        </div>
        {role.system && <p className="text-xs text-muted-foreground">Rôle système : ses droits ne se modifient pas. Créez un rôle sur mesure en le copiant pour l'adapter.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {groups.map((g) => (
            <fieldset key={g.module} className="border border-border rounded-md p-3 space-y-1.5 min-w-0">
              <legend className="text-xs font-medium text-foreground px-1">{g.label}</legend>
              {g.permissions.map((p) => (
                <label key={p.code} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={checked.has(p.code)} disabled={!editable} onChange={() => toggle(p.code)}
                    aria-label={p.label} data-testid={`perm-${p.code}`} className="mt-0.5" />
                  <span className="min-w-0"><span className="text-foreground">{p.label}</span> <span className="font-mono text-muted-foreground">{p.code}</span></span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </div>
    </div>
  );
}

function NewRoleForm({ view, onCreated }: { view: Authorizations; onCreated: (id: string) => void }) {
  const create = useCreateRole();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const taken = view.roles.some((r) => r.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <form className="bg-card border border-border rounded-lg p-4 flex flex-wrap items-end gap-2" data-testid="new-role-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || taken) return;
        create.mutate({ name, description, copyFromRoleId: copyFrom || undefined }, {
          onSuccess: (r: any) => { setName(""); setDescription(""); setCopyFrom(""); if (r?.id) onCreated(r.id); },
        });
      }}>
      <label className="text-xs space-y-1"><span className="text-muted-foreground">Nouveau rôle</span>
        <Input id="new-role-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Caissier" className="h-8 w-44 text-xs" /></label>
      <label className="text-xs space-y-1"><span className="text-muted-foreground">Description</span>
        <Input id="new-role-description" value={description} onChange={(e) => setDescription(e.target.value)} className="h-8 w-56 text-xs" /></label>
      <label className="text-xs space-y-1"><span className="text-muted-foreground">Copier les droits de</span>
        <select id="new-role-copy" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="h-8 w-56 rounded-md border border-input bg-background px-2 text-xs">
          <option value="">— Aucun (rôle vide) —</option>
          {view.roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.system && r.code ? ` (${MODULE_LABELS[moduleOfCode(r.code)] ?? "système"})` : ""}</option>)}
        </select></label>
      <Button type="submit" size="sm" className="text-xs gap-1" disabled={!name.trim() || taken || create.isPending} data-testid="btn-create-role">
        <Plus className="w-3.5 h-3.5" /> Créer le rôle
      </Button>
      {taken && <p className="text-xs text-destructive w-full">Un rôle porte déjà ce nom.</p>}
    </form>
  );
}

/** Module d'un rôle système, déduit de son code (préfixe), pour l'affichage seulement. */
function moduleOfCode(code: string): string {
  const prefix = code.split("_")[0];
  const map: Record<string, string> = {
    procurement: "procurement", sales: "sales", inventory: "inventory", treasury: "treasury", cash: "treasury",
    asset: "assets", budget: "budget", project: "projects", expense: "expenses", compliance: "compliance",
    risk: "risk", hr: "hr", payroll: "hr", crm: "crm",
  };
  return map[prefix] ?? "general";
}

function UsersTab({ view }: { view: Authorizations }) {
  const assign = useAssignRole();
  const revoke = useRevokeRole();
  const roleById = new Map(view.roles.map((r) => [r.id, r]));
  return (
    <div className="bg-card border border-border rounded-lg overflow-x-auto" data-testid="users-tab">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 px-4 font-medium">Utilisateur</th>
            <th className="py-2 px-4 font-medium">Rôles</th>
            {view.canManage && <th className="py-2 px-4 font-medium">Affecter</th>}
          </tr>
        </thead>
        <tbody>
          {view.users.length === 0 && <tr><td colSpan={3} className="py-4 px-4 text-muted-foreground">Aucun utilisateur dans la société.</td></tr>}
          {view.users.map((u) => {
            const assignable = view.roles.filter((r) => !u.roleIds.includes(r.id) && !r.needsReview);
            return (
              <tr key={u.id} className="border-b border-border last:border-0 align-top" data-testid={`user-row-${u.id}`}>
                <td className="py-2 px-4 text-foreground font-medium">{u.fullName}</td>
                <td className="py-2 px-4">
                  <div className="flex flex-wrap gap-1">
                    {u.roleIds.length === 0 && <span className="text-muted-foreground">Aucun rôle</span>}
                    {u.roleIds.map((rid) => {
                      const r = roleById.get(rid);
                      const last = isLastAdmin(view, u.id, rid);
                      return (
                        <span key={rid} className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[11px]">
                          {r?.name ?? "Rôle inconnu"}
                          {view.canManage && (
                            <button aria-label={`Retirer ${r?.name ?? "ce rôle"} à ${u.fullName}`} disabled={last || revoke.isPending}
                              title={last ? "Dernier administrateur de la société : il ne peut pas être retiré" : undefined}
                              onClick={() => revoke.mutate({ userId: u.id, roleId: rid })}
                              className="hover:text-destructive disabled:opacity-40">×</button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </td>
                {view.canManage && (
                  <td className="py-2 px-4">
                    <select aria-label={`Affecter un rôle à ${u.fullName}`} value="" disabled={assign.isPending}
                      onChange={(e) => e.target.value && assign.mutate({ userId: u.id, roleId: e.target.value })}
                      className="h-8 w-56 rounded-md border border-input bg-background px-2 text-xs">
                      <option value="">— Choisir un rôle —</option>
                      {assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AuditTab() {
  const audit = useAuthorizationAudit(true);
  if (audit.isLoading) return <p className="text-sm text-muted-foreground">Chargement du journal…</p>;
  if (audit.isError) return <p className="text-sm text-destructive" role="alert">Journal illisible : {(audit.error as Error)?.message}</p>;
  const rows = audit.data ?? [];
  return (
    <div className="bg-card border border-border rounded-lg overflow-x-auto" data-testid="audit-tab">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 px-4 font-medium">Date</th><th className="py-2 px-4 font-medium">Par</th>
            <th className="py-2 px-4 font-medium">Changement</th><th className="py-2 px-4 font-medium">Détail</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={4} className="py-4 px-4 text-muted-foreground">Aucun changement enregistré.</td></tr>}
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="py-2 px-4 tabular-nums text-muted-foreground whitespace-nowrap">{new Date(r.at).toLocaleString("fr-FR")}</td>
              <td className="py-2 px-4 text-foreground">{r.actor ?? "Système"}</td>
              <td className="py-2 px-4">{AUDIT_LABELS[r.action] ?? r.action}</td>
              <td className="py-2 px-4 text-muted-foreground">
                {[r.roleName, r.targetUser && `→ ${r.targetUser}`, r.permission].filter(Boolean).join(" ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Invitations (V31) : on ne rejoint plus une société en tapant son nom. L'administrateur émet un
 * code à usage unique, daté, avec le rôle d'arrivée, et le transmet lui-même à la personne.
 */
function InvitationsTab({ view }: { view: Authorizations }) {
  const invitations = useInvitations(true);
  const create = useCreateInvitation();
  const revoke = useRevokeInvitation();
  const assignable = useMemo(() => view.roles.filter((r) => !r.needsReview), [view.roles]);
  const viewer = assignable.find((r) => r.code === "viewer");
  const [roleId, setRoleId] = useState<string>("");
  const [validDays, setValidDays] = useState(7);
  const [note, setNote] = useState("");
  const [lastCode, setLastCode] = useState<string | null>(null);
  const roleName = (id: string) => view.roles.find((r) => r.id === id)?.name ?? "Rôle supprimé";
  const effectiveRole = roleId || viewer?.id || "";

  const submit = () => create.mutate(
    { roleId: effectiveRole, validDays, note },
    { onSuccess: (r) => { setLastCode(r.code); setNote(""); } },
  );
  const copy = (code: string) => {
    void navigator.clipboard?.writeText(code).catch(() => undefined);
  };
  const rows = sortInvitations(invitations.data ?? []);

  return (
    <div className="space-y-4" data-testid="invitations-tab">
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <p className="text-xs text-muted-foreground max-w-3xl">
          Pour faire entrer quelqu'un dans la société, créez une invitation et transmettez-lui le code. Le code sert une seule
          fois, expire à la date choisie et donne le rôle d'arrivée indiqué ; les autres rôles s'affectent ensuite dans l'onglet
          « Utilisateurs ». Seule une personne qui n'appartient encore à aucune société peut l'utiliser.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs space-y-1">
            <span className="block text-muted-foreground">Rôle d'arrivée</span>
            <select className="h-9 rounded-md border border-input bg-background px-2 text-sm min-w-[220px]" value={effectiveRole}
              onChange={(e) => setRoleId(e.target.value)} data-testid="invitation-role">
              {assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="text-xs space-y-1">
            <span className="block text-muted-foreground">Validité (jours)</span>
            <Input type="number" min={1} max={30} value={validDays} className="h-9 w-24"
              onChange={(e) => setValidDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} data-testid="invitation-days" />
          </label>
          <label className="text-xs space-y-1 flex-1 min-w-[200px]">
            <span className="block text-muted-foreground">Note (facultatif)</span>
            <Input value={note} maxLength={200} className="h-9" placeholder="Ex. : comptable, arrivée le 1er décembre"
              onChange={(e) => setNote(e.target.value)} data-testid="invitation-note" />
          </label>
          <Button size="sm" onClick={submit} disabled={!effectiveRole || create.isPending} data-testid="invitation-create">
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailPlus className="w-4 h-4" />} Créer l'invitation
          </Button>
        </div>
        {lastCode && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2" data-testid="invitation-last-code">
            <span className="text-xs text-muted-foreground">Code à transmettre :</span>
            <code className="font-mono text-sm font-semibold tracking-wider text-foreground">{lastCode}</code>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => copy(lastCode)} aria-label="Copier le code">
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {invitations.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Chargement des invitations…</p>
        ) : invitations.isError ? (
          <p className="p-4 text-sm text-destructive" role="alert">Invitations illisibles : {(invitations.error as Error)?.message}</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 px-4 font-medium">Code</th><th className="py-2 px-4 font-medium">Rôle d'arrivée</th>
                <th className="py-2 px-4 font-medium">Note</th><th className="py-2 px-4 font-medium">Expire le</th>
                <th className="py-2 px-4 font-medium">Statut</th><th className="py-2 px-4 font-medium"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="py-4 px-4 text-muted-foreground">Aucune invitation.</td></tr>}
              {rows.map((r) => {
                const status = invitationStatus(r);
                return (
                  <tr key={r.id} className="border-b border-border last:border-0" data-testid={`invitation-row-${r.id}`}>
                    <td className="py-2 px-4 font-mono">{r.code}</td>
                    <td className="py-2 px-4">{roleName(r.role_id)}</td>
                    <td className="py-2 px-4 text-muted-foreground">{r.note ?? ""}</td>
                    <td className="py-2 px-4 tabular-nums text-muted-foreground whitespace-nowrap">{new Date(r.expires_at).toLocaleString("fr-FR")}</td>
                    <td className="py-2 px-4">{INVITATION_STATUS_LABELS[status]}</td>
                    <td className="py-2 px-4 text-right">
                      {status === "active" && (
                        <Button size="sm" variant="ghost" className="h-7 text-destructive" disabled={revoke.isPending}
                          onClick={() => revoke.mutate(r.id)} data-testid={`invitation-revoke-${r.id}`}>Révoquer</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
