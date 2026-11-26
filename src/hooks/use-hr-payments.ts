import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost, isApiEnabled } from "@/api/client";
import { useTenantId } from "@/hooks/use-tenant";

/** V154 — format de fichier de virement décrit par la société (gabarit fourni par sa banque). */
export type BankFileColumn = { header: string; field?: string; value?: string };
export type BankFileProfile = {
  id?: string; code: string; label: string; bank_name: string | null; format_version: string | null;
  encoding: "UTF-8" | "ISO-8859-1" | "WINDOWS-1252"; separator: ";" | "," | "|" | "TAB"; header_row: boolean;
  date_format: "DD/MM/YYYY" | "YYYY-MM-DD" | "DDMMYYYY" | "YYYYMMDD"; decimal_separator: "," | "."; amount_decimals: number;
  columns: BankFileColumn[]; notes: string | null; active: boolean;
};
export const FILE_FIELDS: [string, string][] = [
  ["line_number", "N° de ligne"], ["matricule", "Matricule"], ["employee_name", "Nom du bénéficiaire"], ["bank_account", "RIB / compte du bénéficiaire"],
  ["amount", "Montant"], ["currency", "Devise"], ["payment_date", "Date de paiement"], ["reference", "Référence du lot"], ["label", "Libellé (Salaire période)"],
  ["company_name", "Raison sociale"], ["company_account", "Compte de la société"], ["period", "Période"],
];

export type PaymentLine = {
  id: string; line_number: number; employee_id: string; matricule: string; beneficiary_name: string; amount: number;
  status: "pending" | "paid" | "rejected" | "cancelled"; bank_account: string; rejection_reason: string | null; result_date: string | null;
};
export type PaymentBatch = {
  id: string; batch_number: string; run_id: string; period: string; bank_account_id: string; bank_account_name: string;
  profile_id: string; profile_label: string; payment_date: string; currency: string;
  status: "draft" | "approved" | "sent" | "closed" | "cancelled"; total_amount: number; line_count: number; reference: string | null;
  created_by: string; approved_by: string | null; sent_at: string | null; file_name: string | null; file_sha256: string | null;
  cancelled_reason: string | null; lines: PaymentLine[];
};

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw error;
  return data as T;
}

export function useBankFileProfiles() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-bank-file-profiles", tenantId, source],
    enabled: !!tenantId,
    queryFn: async (): Promise<BankFileProfile[]> => {
      if (isApiEnabled()) return apiGet<BankFileProfile[]>("/api/v1/hr/payments/profiles");
      const { data, error } = await (supabase as any).from("payroll_bank_file_profiles").select("*").eq("tenant_id", tenantId).order("label");
      if (error) throw error;
      return (data ?? []) as BankFileProfile[];
    },
  });
}

export function usePaymentBatches() {
  const { data: tenantId } = useTenantId();
  const source = isApiEnabled() ? "api" : "supabase";
  return useQuery({
    queryKey: ["hr-payment-batches", tenantId, source],
    enabled: !!tenantId,
    queryFn: async () => ((isApiEnabled() ? await apiGet<PaymentBatch[]>("/api/v1/hr/payments/batches")
      : await rpc<PaymentBatch[]>("list_payroll_payment_batches", { _run_id: null })) ?? []),
  });
}

function usePaymentMutation<A, R>(run: (args: A) => Promise<R>, success: string | ((r: R) => string)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (result) => {
      for (const key of ["hr-payment-batches", "hr-bank-file-profiles", "journal-entries", "treasury-movements", "bank-accounts"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      toast.success(typeof success === "function" ? success(result) : success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export const useSaveBankFileProfile = () => usePaymentMutation((p: BankFileProfile) =>
  (isApiEnabled() ? apiPost("/api/v1/hr/payments/profiles", p) : rpc("save_payroll_bank_file_profile", { _input: p })), "Format enregistré.");

export const useCreatePaymentBatch = () => usePaymentMutation((a: { run_id: string; bank_account_id: string; profile_id: string; payment_date: string; reference: string | null }) =>
  (isApiEnabled() ? apiPost("/api/v1/hr/payments/batches", a)
    : rpc("create_payroll_payment_batch", { _run_id: a.run_id, _bank_account_id: a.bank_account_id, _profile_id: a.profile_id,
      _payment_date: a.payment_date, _reference: a.reference })), "Lot préparé : il doit être approuvé par une autre personne.");

export const useApprovePaymentBatch = () => usePaymentMutation((id: string) =>
  (isApiEnabled() ? apiPost(`/api/v1/hr/payments/batches/${encodeURIComponent(id)}/approve`, {}) : rpc("approve_payroll_payment_batch", { _batch_id: id })),
  "Lot approuvé.");

export const useCancelPaymentBatch = () => usePaymentMutation((a: { id: string; reason: string }) =>
  (isApiEnabled() ? apiPost(`/api/v1/hr/payments/batches/${encodeURIComponent(a.id)}/cancel`, { reason: a.reason })
    : rpc("cancel_payroll_payment_batch", { _batch_id: a.id, _reason: a.reason })), "Lot annulé.");

export type PaymentFile = { file_name: string; encoding: string; content: string; sha256: string };
export const usePaymentFile = () => usePaymentMutation(async (id: string) => {
  const file = isApiEnabled() ? await apiPost<PaymentFile>(`/api/v1/hr/payments/batches/${encodeURIComponent(id)}/file`, {})
    : await rpc<PaymentFile>("generate_payroll_payment_file", { _batch_id: id });
  downloadPaymentFile(file);
  return file;
}, (f) => `Fichier ${f.file_name} téléchargé (empreinte ${f.sha256.slice(0, 12)}…).`);

export const useRecordPaymentResults = () => usePaymentMutation((a: { id: string; results: { line_id: string; status: "paid" | "rejected"; reason?: string }[]; result_date: string }) =>
  (isApiEnabled() ? apiPost(`/api/v1/hr/payments/batches/${encodeURIComponent(a.id)}/results`, { results: a.results, result_date: a.result_date })
    : rpc("record_payroll_payment_results", { _batch_id: a.id, _results: a.results, _result_date: a.result_date })),
  "Retours enregistrés : les paiements confirmés sont comptabilisés.");

/** Fichier dans l'encodage du profil : UTF-8, ou octet par caractère pour ISO-8859-1 / Windows-1252 (refus si hors jeu). */
export function encodePaymentFile(content: string, encoding: string): Uint8Array<ArrayBuffer> {
  if (encoding === "UTF-8") return new Uint8Array(new TextEncoder().encode(content));
  const win1252: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94,
    0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    const mapped = code <= 0xff ? code : encoding === "WINDOWS-1252" ? win1252[code] : undefined;
    if (mapped === undefined) throw new Error(`Caractère « ${content[i]} » impossible à écrire en ${encoding}`);
    bytes[i] = mapped;
  }
  return bytes;
}

function downloadPaymentFile(file: PaymentFile) {
  const blob = new Blob([encodePaymentFile(file.content, file.encoding)], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.file_name;
  a.click();
  URL.revokeObjectURL(url);
}
