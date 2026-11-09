import { useState, useMemo } from "react";
import { PageShell } from "@/components/PageShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GuidanceBanner } from "@/components/GuidanceBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ChevronDown, ChevronRight, Search, Plus, Settings, FolderTree,
  Pencil, Trash2, X, Check, AlertTriangle, FileText, Loader2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useGLAccounts, useAccountBalances, buildAccountTree, categorizeAccounts,
  useCreateGLAccount, useUpdateGLAccount, type AccountWithBalance,
} from "@/hooks/use-gl-data";

const accountTypes = [
  "asset", "liability", "equity", "revenue", "expense",
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

// ── Tree Item ─────────────────────────────────────────────
function TreeItem({ account, depth = 0, selectedId, onSelect }: {
  account: AccountWithBalance; depth?: number; selectedId: string | null; onSelect: (a: AccountWithBalance) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = account.children.length > 0;
  const isSelected = selectedId === account.id;

  return (
    <>
      <button
        onClick={() => { onSelect(account); if (hasChildren) setOpen(!open); }}
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1.5 text-xs transition-colors rounded-sm",
          isSelected ? "bg-primary/10 text-primary font-medium" : "text-foreground hover:bg-muted/50"
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {hasChildren ? (open ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />) : <span className="w-3 shrink-0" />}
        <span className="font-mono text-[10px] text-muted-foreground shrink-0">{account.code}</span>
        <span className="truncate">{account.name}</span>
        {!account.is_active && <span className="ml-auto text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">Inactive</span>}
      </button>
      {open && hasChildren && account.children.map(child => (
        <TreeItem key={child.id} account={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </>
  );
}

// ── Account Form Dialog ─────────────────────────────────────
function AccountFormDialog({ open, onClose, account, accounts, mode, onCreate, onUpdate }: {
  open: boolean; onClose: () => void;
  account: { id?: string; code: string; name: string; account_type: string; parent_id: string | null; is_active: boolean } | null;
  accounts: AccountWithBalance[];
  mode: "create" | "edit";
  onCreate: any; onUpdate: any;
}) {
  const [form, setForm] = useState(account || { code: "", name: "", account_type: "asset", parent_id: null as string | null, is_active: true });
  const update = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSave = () => {
    if (!form.code || !form.name) { toast.error("Code et nom requis"); return; }
    if (mode === "create") {
      onCreate.mutate({ code: form.code, name: form.name, account_type: form.account_type, parent_id: form.parent_id || null });
    } else if (account?.id) {
      onUpdate.mutate({ id: account.id, name: form.name, account_type: form.account_type, is_active: form.is_active, parent_id: form.parent_id || null });
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{mode === "create" ? "Nouveau compte" : `Modifier ${account?.code}`}</DialogTitle>
          <DialogDescription className="text-xs">{mode === "create" ? "Ajouter un compte au plan comptable" : "Modifier les propriétés du compte"}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Code *</Label>
            <Input className="h-8 text-xs font-mono" value={form.code} onChange={e => update("code", e.target.value)} disabled={mode === "edit"} placeholder="ex: 1040" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nom *</Label>
            <Input className="h-8 text-xs" value={form.name} onChange={e => update("name", e.target.value)} placeholder="ex: Titres de placement" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <select className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={form.account_type} onChange={e => update("account_type", e.target.value)}>
              {accountTypes.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Compte parent</Label>
            <select className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs" value={form.parent_id || ""} onChange={e => update("parent_id", e.target.value || null)}>
              <option value="">— (Top Level)</option>
              {accounts.filter(a => a.id !== account?.id).map(a => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
            </select>
          </div>
        </div>
        {mode === "edit" && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <label className="text-xs">Actif</label>
            <Switch checked={form.is_active} onCheckedChange={v => update("is_active", v)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>Annuler</Button>
          <Button size="sm" className="text-xs" onClick={handleSave}>{mode === "create" ? "Créer" : "Enregistrer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main ─────────────────────────────────────────────────────
export default function GLMasterData() {
  const { data: accounts = [], isLoading } = useGLAccounts();
  const { data: balances = {} } = useAccountBalances();
  const createAccount = useCreateGLAccount();
  const updateAccount = useUpdateGLAccount();

  const [search, setSearch] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<AccountWithBalance | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["Assets", "Liabilities", "Equity", "Revenue", "Expenses"]));
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editAccount, setEditAccount] = useState<AccountWithBalance | null>(null);
  const [deactivateAccount, setDeactivateAccount] = useState<AccountWithBalance | null>(null);

  const tree = useMemo(() => buildAccountTree(accounts, balances), [accounts, balances]);
  const categories = useMemo(() => categorizeAccounts(tree), [tree]);

  // Flatten for table
  const flatAccounts = useMemo(() => {
    const flat: AccountWithBalance[] = [];
    const walk = (list: AccountWithBalance[]) => { list.forEach(a => { flat.push(a); walk(a.children); }); };
    tree.forEach(a => { flat.push(a); walk(a.children); });
    return flat;
  }, [tree]);

  const filteredFlat = flatAccounts.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) || a.code.includes(search)
  );

  const toggleCategory = (cat: string) => {
    const next = new Set(expandedCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setExpandedCategories(next);
  };

  const handleDeactivate = () => {
    if (deactivateAccount) {
      updateAccount.mutate({ id: deactivateAccount.id, is_active: false });
      setDeactivateAccount(null);
    }
  };

  const totalAccounts = flatAccounts.length;
  const activeAccounts = flatAccounts.filter(a => a.is_active).length;
  const inactiveAccounts = totalAccounts - activeAccounts;

  if (isLoading) return <PageShell><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></PageShell>;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: "Finance", href: "/" }, { label: "General Ledger", href: "/journal" }, { label: "Plan Comptable" }]} />
      <GuidanceBanner message="Gérez le plan comptable hiérarchique. Créez, modifiez et désactivez des comptes. Les soldes sont calculés à partir des écritures comptables validées." />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Plan Comptable</h1>
          <p className="text-xs text-muted-foreground">{totalAccounts} comptes · {activeAccounts} actifs</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5"><FileText className="w-3.5 h-3.5" /> Export</Button>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setShowCreateDialog(true)}><Plus className="w-3.5 h-3.5" /> Ajouter un compte</Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total comptes", value: totalAccounts, color: "text-foreground" },
          { label: "Actifs", value: activeAccounts, color: "text-success" },
          { label: "Inactifs", value: inactiveAccounts, color: "text-muted-foreground" },
          { label: "Avec mouvements", value: flatAccounts.filter(a => a.debit_total > 0 || a.credit_total > 0).length, color: "text-primary" },
        ].map(k => (
          <div key={k.label} className="bg-card rounded-lg border border-border p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{k.label}</p>
            <p className={cn("text-xl font-semibold tabular-nums mt-1", k.color)}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: Tree */}
        <div className="lg:col-span-3 card-elevated">
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="Rechercher…" className="pl-8 h-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="p-2 max-h-[600px] overflow-y-auto">
            {search ? (
              filteredFlat.map(a => (
                <button key={a.id} onClick={() => setSelectedAccount(a)}
                  className={cn("w-full flex items-center gap-1.5 px-2 py-1.5 text-xs transition-colors rounded-sm",
                    selectedAccount?.id === a.id ? "bg-primary/10 text-primary font-medium" : "text-foreground hover:bg-muted/50"
                  )}>
                  <span className="font-mono text-[10px] text-muted-foreground">{a.code}</span>
                  <span className="truncate">{a.name}</span>
                </button>
              ))
            ) : (
              categories.map(cat => (
                <div key={cat.category} className="mb-1">
                  <button onClick={() => toggleCategory(cat.category)}
                    className="w-full flex items-center gap-1.5 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
                    {expandedCategories.has(cat.category) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span>{cat.icon} {cat.category}</span>
                    <span className="ml-auto text-[10px] font-normal">{cat.accounts.length}</span>
                  </button>
                  {expandedCategories.has(cat.category) && cat.accounts.map(a => (
                    <TreeItem key={a.id} account={a} selectedId={selectedAccount?.id || null} onSelect={setSelectedAccount} />
                  ))}
                </div>
              ))
            )}
            {flatAccounts.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">Aucun compte. Créez votre premier compte.</p>}
          </div>
        </div>

        {/* MIDDLE: Table */}
        <div className={cn("card-elevated", selectedAccount ? "lg:col-span-6" : "lg:col-span-9")}>
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Répertoire des comptes</h3>
            <span className="text-[11px] text-muted-foreground">{filteredFlat.length} comptes</span>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th><th>Nom</th><th>Type</th><th>Statut</th>
                  <th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right">Solde</th><th className="w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(search ? filteredFlat : flatAccounts).map(a => (
                  <tr key={a.id} onClick={() => setSelectedAccount(a)}
                    className={cn("cursor-pointer", selectedAccount?.id === a.id && "bg-primary/5")}>
                    <td className="font-mono font-medium text-foreground">{a.code}</td>
                    <td>{a.name}</td>
                    <td className="text-muted-foreground capitalize">{a.account_type}</td>
                    <td><StatusBadge status={a.is_active ? "Active" : "Inactive"} /></td>
                    <td className="text-right tabular-nums">{a.debit_total ? fmt(a.debit_total) : "—"}</td>
                    <td className="text-right tabular-nums">{a.credit_total ? fmt(a.credit_total) : "—"}</td>
                    <td className="text-right tabular-nums font-medium">{fmt(Math.abs(a.balance))}</td>
                    <td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <button className="p-1 rounded hover:bg-muted" title="Modifier" onClick={() => setEditAccount(a)}>
                          <Pencil className="w-3 h-3 text-muted-foreground" />
                        </button>
                        {a.is_active && (
                          <button className="p-1 rounded hover:bg-muted" title="Désactiver" onClick={() => setDeactivateAccount(a)}>
                            <Trash2 className="w-3 h-3 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: Config Panel */}
        {selectedAccount && (
          <div className="lg:col-span-3 card-elevated">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Configuration</p>
              </div>
              <button onClick={() => setSelectedAccount(null)} className="p-1 rounded hover:bg-muted"><X className="w-3 h-3 text-muted-foreground" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Compte</p>
                <p className="text-sm font-semibold text-foreground">{selectedAccount.code} – {selectedAccount.name}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Type</p><p className="text-xs capitalize">{selectedAccount.account_type}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Statut</p><p className="text-xs">{selectedAccount.is_active ? "Actif" : "Inactif"}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Débit</p><p className="text-xs tabular-nums font-medium">{fmt(selectedAccount.debit_total)}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Crédit</p><p className="text-xs tabular-nums font-medium">{fmt(selectedAccount.credit_total)}</p></div>
              </div>
              <div className="border-t border-border pt-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Solde net</p>
                <p className={cn("text-lg font-bold tabular-nums", selectedAccount.balance >= 0 ? "text-success" : "text-destructive")}>{fmt(selectedAccount.balance)} XOF</p>
              </div>
              {selectedAccount.children.length > 0 && (
                <div className="border-t border-border pt-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Sous-comptes ({selectedAccount.children.length})</p>
                  {selectedAccount.children.map(c => (
                    <div key={c.id} className="flex justify-between text-xs py-1">
                      <span className="font-mono text-muted-foreground">{c.code}</span>
                      <span className="truncate mx-2">{c.name}</span>
                      <span className="tabular-nums font-medium">{fmt(Math.abs(c.balance))}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-border pt-4 flex gap-2">
                <Button size="sm" className="flex-1 text-xs" onClick={() => setEditAccount(selectedAccount)}>
                  <Pencil className="w-3 h-3 mr-1" /> Modifier
                </Button>
                {selectedAccount.is_active && (
                  <Button size="sm" variant="outline" className="text-xs text-destructive" onClick={() => setDeactivateAccount(selectedAccount)}>Désactiver</Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      {showCreateDialog && (
        <AccountFormDialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)}
          account={null} accounts={flatAccounts} mode="create" onCreate={createAccount} onUpdate={updateAccount} />
      )}
      {editAccount && (
        <AccountFormDialog open={!!editAccount} onClose={() => setEditAccount(null)}
          account={editAccount} accounts={flatAccounts} mode="edit" onCreate={createAccount} onUpdate={updateAccount} />
      )}
      <AlertDialog open={!!deactivateAccount} onOpenChange={() => setDeactivateAccount(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-destructive" />Désactiver le compte</AlertDialogTitle>
            <AlertDialogDescription className="text-xs space-y-2">
              <p>Vous allez désactiver le compte <span className="font-medium text-foreground">{deactivateAccount?.code} — {deactivateAccount?.name}</span>.</p>
              <div className="bg-muted/50 rounded p-3 space-y-1">
                <p>• Les écritures futures seront bloquées</p>
                <p>• Les écritures existantes sont conservées</p>
                <p>• Le compte sera masqué dans les formulaires</p>
              </div>
              {deactivateAccount && Math.abs(deactivateAccount.balance) > 0 && (
                <p className="text-destructive font-medium">⚠ Ce compte a un solde de {fmt(Math.abs(deactivateAccount.balance))} XOF.</p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Annuler</AlertDialogCancel>
            <AlertDialogAction className="text-xs bg-destructive hover:bg-destructive/90" onClick={handleDeactivate}>Confirmer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
