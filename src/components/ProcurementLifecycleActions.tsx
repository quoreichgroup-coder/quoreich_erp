import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useMyAccess } from "@/hooks/use-my-access";
import {
  useApproveStep, useCancelProcurement, useDeleteProcurementDraft, useRejectStep, useSubmitProcurement,
  type ProcurementDocType,
} from "@/hooks/use-procurement-data";

/**
 * Actions d'une pièce d'achat selon son statut et selon la personne qui la regarde (V39) :
 * brouillon ou rejetée → Modifier, Soumettre, Supprimer ; soumise → niveau en cours, et pour un
 * tiers habilité Approuver / Rejeter ; approuvée → Annuler (tant que rien n'est reçu ou converti).
 * L'écran ne fait que proposer : la base applique les seuils, l'ordre et la séparation des tâches.
 */
export function ProcurementLifecycleActions({ docType, doc, approvals, onEdit, extra }: {
  docType: ProcurementDocType;
  doc: any;
  approvals: any[];
  onEdit: () => void;
  extra?: React.ReactNode;
}) {
  const { user } = useAuth();
  const { data: access } = useMyAccess();
  const submit = useSubmitProcurement();
  const approve = useApproveStep();
  const reject = useRejectStep();
  const cancel = useCancelProcurement();
  const remove = useDeleteProcurementDraft();
  const [reason, setReason] = useState<null | "reject" | "cancel">(null);
  const [text, setText] = useState("");

  const creator = docType === "PR" ? doc.requested_by : doc.created_by;
  const isCreator = !!user && user.id === creator;
  const pending = approvals
    .filter((a) => a.doc_id === doc.id && a.status === "pending")
    .sort((a, b) => a.level_order - b.level_order)[0];
  const decidedByMe = approvals.some((a) => a.doc_id === doc.id && a.status === "approved" && a.decided_by === user?.id);
  const canDecide = !!pending && !isCreator && !decidedByMe
    && (access?.permissions ?? []).includes(`procurement.approve_l${Math.min(pending.level_order, 3)}`);
  const s = doc.status as string;
  const btn = "h-6 text-[10px]";

  return (
    <>
      {(s === "draft" || s === "rejected") && (
        <>
          <Button size="sm" variant="ghost" className={btn} onClick={onEdit}>Modifier</Button>
          <Button size="sm" variant="ghost" className={`${btn} text-primary`} disabled={submit.isPending}
            onClick={() => submit.mutate({ docType, id: doc.id })}>Soumettre</Button>
          <Button size="sm" variant="ghost" className={`${btn} text-destructive`} disabled={remove.isPending}
            onClick={() => { if (window.confirm("Supprimer cette pièce ?")) remove.mutate({ docType, id: doc.id }); }}>Supprimer</Button>
        </>
      )}
      {s === "pending_approval" && pending && (
        <>
          <span className="text-[10px] text-muted-foreground" data-testid="approval-level">
            {pending.level_label}{isCreator ? " · vous êtes l'auteur" : ""}
          </span>
          {canDecide && (
            <>
              <Button size="sm" variant="ghost" className={`${btn} text-success`} disabled={approve.isPending}
                onClick={() => approve.mutate({ id: pending.id })}>Approuver</Button>
              <Button size="sm" variant="ghost" className={`${btn} text-destructive`}
                onClick={() => { setText(""); setReason("reject"); }}>Rejeter</Button>
            </>
          )}
        </>
      )}
      {(s === "approved" || s === "ordered" || s === "pending_approval") && !(docType === "PR" && doc.po_id) && (
        <Button size="sm" variant="ghost" className={btn} onClick={() => { setText(""); setReason("cancel"); }}>Annuler</Button>
      )}
      {extra}

      <Dialog open={reason !== null} onOpenChange={(o) => { if (!o) setReason(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{reason === "reject" ? "Rejeter la pièce" : "Annuler la pièce"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="lifecycle-reason">Motif (obligatoire)</Label>
            <Textarea id="lifecycle-reason" value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setReason(null)}>Retour</Button>
            <Button size="sm" variant="destructive" disabled={!text.trim() || reject.isPending || cancel.isPending}
              onClick={() => {
                const done = { onSuccess: () => setReason(null) };
                if (reason === "reject" && pending) reject.mutate({ id: pending.id, comment: text.trim() }, done);
                else cancel.mutate({ docType, id: doc.id, reason: text.trim() }, done);
              }}>
              {reason === "reject" ? "Rejeter" : "Annuler la pièce"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
