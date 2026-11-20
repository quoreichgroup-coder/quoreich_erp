import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiOpenFile, apiPatch, apiPost, apiPut, apiUpload, isApiEnabled } from "@/api/client";
import { fetchTenantId, useTenantId } from "@/hooks/use-tenant";
import { attachmentPath, sha256Hex, type AttachmentDocType } from "@/lib/attachments";

/*
 * Pièces jointes (V138). Nuage : fichier déposé dans le compartiment privé « documents », puis enregistré par
 * register_attachment (contrôles de la société) ; un enregistrement refusé retire le dépôt orphelin. Sur site : l'API
 * stocke le fichier et calcule l'empreinte. La table est en lecture seule : tout passe par les fonctions.
 */
const db = supabase as any;
const API = "/api/v1/attachments";

async function check<T>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export type Attachment = {
  id: string; doc_type: string; doc_id: string; category_id: string | null; category_label?: string | null; file_name: string; mime_type: string;
  size_bytes: number; sha256: string | null; storage_path: string; note: string | null; uploaded_by: string; uploaded_by_name?: string | null;
  uploaded_at: string; deleted_at: string | null; delete_reason: string | null;
};

export function useAttachments(docType: AttachmentDocType, docId: string | null | undefined) {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["attachments", tenantId, docType, docId],
    enabled: Boolean(tenantId && docId),
    queryFn: async (): Promise<Attachment[]> => {
      if (isApiEnabled()) return apiGet<Attachment[]>(`${API}?docType=${docType}&docId=${docId}`);
      return check<Attachment[]>(db.from("document_attachments")
        .select("*, category:attachment_categories(label)")
        .eq("doc_type", docType).eq("doc_id", docId).order("uploaded_at"))
        .then((rows: any[]) => rows.map((r) => ({ ...r, category_label: r.category?.label ?? null })));
    },
  });
}

export function useAttachmentCategories() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["attachment-categories", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<any[]> => {
      if (isApiEnabled()) return apiGet<any[]>(`${API}/categories`);
      await check(db.rpc("ensure_attachment_categories"));
      return check<any[]>(db.from("attachment_categories").select("*").order("sort_order").order("label"));
    },
  });
}

export function useAttachmentSettings() {
  const { data: tenantId } = useTenantId();
  return useQuery({
    queryKey: ["attachment-settings", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<any> => isApiEnabled() ? apiGet<any>(`${API}/settings`)
      : check<any>(db.from("attachment_settings").select("*").maybeSingle()),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["attachments"] });
}

export function useUploadAttachment(docType: AttachmentDocType, docId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { file: File; categoryId: string | null; note: string | null }) => {
      if (isApiEnabled()) {
        const q = new URLSearchParams();
        if (v.categoryId) q.set("categoryId", v.categoryId);
        if (v.note) q.set("note", v.note);
        return apiUpload(`${API}/${docType}/${docId}${q.size ? `?${q}` : ""}`, "file", v.file);
      }
      const tenant = await fetchTenantId();
      const path = attachmentPath(tenant, docType, docId, v.file.name, crypto.randomUUID());
      const sha = await sha256Hex(await v.file.arrayBuffer());
      const up = await supabase.storage.from("documents").upload(path, v.file, { contentType: v.file.type || "application/octet-stream", upsert: false });
      if (up.error) throw new Error(up.error.message);
      const { error } = await db.rpc("register_attachment", {
        _doc_type: docType, _doc_id: docId, _storage_path: path, _file_name: v.file.name, _mime_type: v.file.type || "application/octet-stream",
        _size_bytes: v.file.size, _sha256: sha, _category_id: v.categoryId, _note: v.note,
      });
      if (error) {
        await supabase.storage.from("documents").remove([path]).catch(() => undefined);
        throw new Error(error.message);
      }
    },
    onSuccess: () => { invalidate(qc); toast.success("Pièce jointe ajoutée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; reason: string }) => isApiEnabled()
      ? apiPost(`${API}/${v.id}/delete`, { reason: v.reason })
      : check(db.rpc("delete_attachment", { _id: v.id, _reason: v.reason })),
    onSuccess: () => { invalidate(qc); toast.success("Pièce jointe supprimée (gardée en archive)"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export async function openAttachment(a: Attachment) {
  if (isApiEnabled()) return apiOpenFile(`${API}/${a.id}/file`);
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(a.storage_path, 60);
  if (error || !data?.signedUrl) { toast.error(error?.message ?? "Fichier introuvable"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

export function useSaveAttachmentCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: any) => {
      if (isApiEnabled()) return c.id ? apiPatch(`${API}/categories/${c.id}`, c) : apiPost(`${API}/categories`, c);
      const rows = c.id
        ? await check<any[]>(db.from("attachment_categories").update(c).eq("id", c.id).select("id"))
        : await check<any[]>(db.from("attachment_categories").insert({ ...c, tenant_id: await fetchTenantId() }).select("id"));
      if (!rows?.length) throw new Error("Catégorie non enregistrée (droit « Paramétrer les pièces jointes » requis)");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attachment-categories"] }); toast.success("Catégorie enregistrée"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSaveAttachmentSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: any) => isApiEnabled() ? apiPut(`${API}/settings`, s)
      : check(db.from("attachment_settings").upsert({ tenant_id: await fetchTenantId(), ...s, updated_at: new Date().toISOString() })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attachment-settings"] }); toast.success("Réglages des pièces jointes enregistrés"); },
    onError: (e: Error) => toast.error(e.message),
  });
}
