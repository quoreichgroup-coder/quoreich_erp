import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyAccess } from "@/hooks/use-my-access";
import { openAttachment, useAttachmentCategories, useAttachments, useDeleteAttachment, useUploadAttachment } from "@/hooks/use-attachments";
import { categoriesFor, formatSize, type AttachmentDocType } from "@/lib/attachments";

/*
 * Pièces jointes d'une pièce (V138) : liste, dépôt (catégorie, commentaire), ouverture, suppression avec motif. Une pièce
 * jointe supprimée reste visible dans l'historique (archive) ; les contrôles (taille, types, pièce validée) sont ceux de la
 * base, qui répond en français.
 */
export function Attachments({ docType, docId, compact = false }: { docType: AttachmentDocType; docId: string | null | undefined; compact?: boolean }) {
  const list = useAttachments(docType, docId);
  const cats = useAttachmentCategories();
  const access = useMyAccess();
  const perms = access.data?.permissions ?? [];
  const canAttach = perms.includes("documents.attach");
  const upload = useUploadAttachment(docType, docId ?? "");
  const remove = useDeleteAttachment();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  if (!docId) return null;
  const rows = list.data ?? [];
  const live = rows.filter((a) => !a.deleted_at);
  const deleted = rows.filter((a) => a.deleted_at);
  const options = categoriesFor((cats.data ?? []) as any[], docType);
  const idp = `att-${docType}`;
  const send = () => {
    if (!file) return;
    upload.mutate({ file, categoryId: category || null, note: note.trim() || null }, {
      onSuccess: () => { setFile(null); setNote(""); if (fileRef.current) fileRef.current.value = ""; },
    });
  };
  return (
    <section aria-label="Pièces jointes" className="space-y-2 border-t border-border pt-3 text-xs" data-testid="attachments">
      <p className="font-medium flex items-center gap-1"><Paperclip className="w-3 h-3" />Pièces jointes ({live.length})</p>
      {live.length === 0 && !compact && <p className="text-muted-foreground">Aucune pièce jointe.</p>}
      {live.length > 0 && (
        <table className="w-full">
          <tbody>{live.map((a) => (
            <tr key={a.id} className="border-t border-border/50" data-testid="attachment-row">
              <td className="py-1"><button type="button" className="text-primary hover:underline text-left" onClick={() => openAttachment(a)}>{a.file_name}</button>
                {a.note && <span className="text-muted-foreground"> — {a.note}</span>}</td>
              <td>{a.category_label ?? "—"}</td>
              <td className="text-right tabular-nums">{formatSize(Number(a.size_bytes))}</td>
              <td className="text-muted-foreground">{new Date(a.uploaded_at).toLocaleDateString("fr-FR")}{a.uploaded_by_name ? ` · ${a.uploaded_by_name}` : ""}</td>
              <td className="text-right">{canAttach && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" data-testid="attachment-delete" disabled={remove.isPending}
                  onClick={() => { const reason = window.prompt(`Motif de la suppression de « ${a.file_name} » (le fichier reste archivé) :`); if (reason && reason.trim()) remove.mutate({ id: a.id, reason: reason.trim() }); }}>
                  Supprimer</Button>)}</td>
            </tr>))}</tbody>
        </table>
      )}
      {deleted.length > 0 && (
        <div>
          <button type="button" className="text-muted-foreground hover:underline" onClick={() => setShowDeleted((v) => !v)}>
            {showDeleted ? "Masquer" : "Afficher"} les pièces jointes supprimées ({deleted.length})</button>
          {showDeleted && <ul className="mt-1 space-y-0.5 text-muted-foreground">{deleted.map((a) => (
            <li key={a.id}><span className="line-through">{a.file_name}</span> — supprimée le {new Date(a.deleted_at!).toLocaleDateString("fr-FR")} : {a.delete_reason}</li>))}</ul>}
        </div>
      )}
      {canAttach && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs" htmlFor={`${idp}-file`}>Fichier à joindre</Label>
            <Input id={`${idp}-file`} ref={fileRef} type="file" className="h-8 text-xs w-56" data-testid="attachment-file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor={`${idp}-category`}>Catégorie</Label>
            <select id={`${idp}-category`} className="h-8 px-2 rounded-md border border-input bg-background text-xs" value={category} data-testid="attachment-category"
              onChange={(e) => setCategory(e.target.value)}>
              <option value="">—</option>{options.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          <div className="space-y-1"><Label className="text-xs" htmlFor={`${idp}-note`}>Commentaire</Label>
            <Input id={`${idp}-note`} className="h-8 text-xs w-40" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <Button size="sm" className="h-8 text-xs" disabled={!file || upload.isPending} onClick={send} data-testid="attachment-upload">Joindre</Button>
        </div>
      )}
    </section>
  );
}
