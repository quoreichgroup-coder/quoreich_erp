import { readXlsx, type XlsxColumn } from "@/lib/xlsx";
import { CAMPAIGN_SCOPE_LABEL, CAMPAIGN_STATUS_LABEL, parseInventoryCount, type CampaignCatalogCursor, type CampaignCatalogFilters,
  type CampaignCatalogPage, type CampaignCatalogRow, type CampaignCountEntry, type CampaignStage,
  type InventoryCampaignItem } from "@/lib/inventory-campaign";

const stageName: Record<CampaignStage, string> = { first: "Comptage initial", recount: "Recomptage" };
type CountSheetRow = {
  campaign: string; reference: string; stage: string; item: string; code: string; name: string; unit: string;
  quantity: number | null;
};
const campaignHeader = "Identifiant campagne";
const stageHeader = "Étape";
const itemHeader = "Identifiant article";
const codeHeader = "Code article";
const unitHeader = "Unité";
const quantityHeader = "Quantité comptée";

export const countSheetColumns: XlsxColumn<CountSheetRow>[] = [
  { key: "reference", header: "Référence campagne", width: 24 },
  { key: "code", header: codeHeader, width: 18 },
  { key: "name", header: "Désignation", width: 35 },
  { key: "unit", header: unitHeader, width: 12 },
  { key: "quantity", header: quantityHeader, width: 20 },
  { key: "stage", header: stageHeader, width: 20 },
  { key: "campaign", header: campaignHeader, width: 40 },
  { key: "item", header: itemHeader, width: 40 },
];

export function countSheetRows(campaign: string, reference: string | null, stage: CampaignStage, items: InventoryCampaignItem[]): CountSheetRow[] {
  return items.map((item) => ({
    campaign, reference: reference ?? campaign, stage: stageName[stage], item: item.item_id,
    code: item.code, name: item.name, unit: item.unit, quantity: null,
  }));
}

export async function parseCampaignCountWorkbook(
  buffer: ArrayBuffer, campaign: string, stage: CampaignStage, items: InventoryCampaignItem[],
): Promise<CampaignCountEntry[]> {
  const { headers, records } = await readXlsx(buffer);
  const required = [campaignHeader, stageHeader, itemHeader, codeHeader, unitHeader, quantityHeader];
  if (required.some((header) => headers.filter((value) => value === header).length !== 1)) {
    throw new Error("Les colonnes de la feuille ne correspondent pas au modèle. Téléchargez à nouveau la feuille de comptage.");
  }
  const expected = new Map(items.map((item) => [item.item_id, item]));
  const seen = new Set<string>();
  const errors: string[] = [];
  const entries: CampaignCountEntry[] = [];
  for (const [i, row] of records.entries()) {
    const raw = row[quantityHeader];
    if (!raw) continue;
    const item = row[itemHeader];
    const expectedItem = expected.get(item);
    const quantity = parseInventoryCount(raw);
    const position = `Entrée ${i + 1}`;
    if (row[campaignHeader] !== campaign) errors.push(`${position} : autre campagne.`);
    else if (row[stageHeader] !== stageName[stage]) errors.push(`${position} : étape de comptage différente.`);
    else if (!expectedItem) errors.push(`${position} : article hors feuille de comptage ou déjà traité.`);
    else if (row[codeHeader] !== expectedItem.code.trim() || row[unitHeader] !== expectedItem.unit.trim()) {
      errors.push(`${position} : le code ou l’unité ne correspond pas à l’identifiant article. Utilisez une feuille à jour.`);
    }
    else if (seen.has(item)) errors.push(`${position} : article en double.`);
    else if (quantity === null) errors.push(`${position} : quantité invalide (nombre positif ou nul, deux décimales maximum).`);
    else {
      seen.add(item);
      entries.push({ item_id: item, quantity });
    }
  }
  if (errors.length) {
    throw new Error(`${errors.slice(0, 6).join("\n")}${errors.length > 6 ? `\nEt ${errors.length - 6} autre(s) erreur(s).` : ""}`);
  }
  if (!entries.length) throw new Error("Aucune quantité saisie. Une cellule vide est ignorée ; saisissez 0 pour une absence confirmée.");
  if (entries.length > 5000) throw new Error("Importez au plus 5 000 quantités par classeur.");
  return entries;
}

type FetchCatalogPage = (filters: CampaignCatalogFilters, cursor: CampaignCatalogCursor | null, forExport: boolean) => Promise<CampaignCatalogPage>;

export async function readCampaignCatalogAll(filters: CampaignCatalogFilters, fetchPage: FetchCatalogPage): Promise<CampaignCatalogRow[]> {
  const result: CampaignCatalogRow[] = [];
  const seen = new Set<string>();
  let cursor: CampaignCatalogCursor | null = null;
  do {
    const page = await fetchPage(filters, cursor, true);
    for (const row of page.campaigns) {
      if (seen.has(row.id)) throw new Error("Le catalogue a changé pendant l’export. Relancez l’export.");
      seen.add(row.id);
      result.push(row);
    }
    if (result.length > 1_048_575) throw new Error("Trop de campagnes pour une feuille Excel. Affinez les filtres.");
    if (page.next && (!page.campaigns.length || (page.next.id === cursor?.id && page.next.opened_at === cursor.opened_at))) {
      throw new Error("Pagination du catalogue interrompue. Relancez l’export.");
    }
    cursor = page.next;
  } while (cursor);
  return result;
}

export const formatCatalogDate = (date: string) => new Date(date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

export function catalogueWorkbookRows(rows: CampaignCatalogRow[]) {
  return rows.map((row) => ({
    reference: row.reference ?? row.id, warehouse: row.warehouse_code, warehouseName: row.warehouse_name,
    state: CAMPAIGN_STATUS_LABEL[row.state], scope: CAMPAIGN_SCOPE_LABEL[row.item_scope],
    opened: formatCatalogDate(row.opened_at), updated: formatCatalogDate(row.updated_at),
    submitted: row.submitted_at ? formatCatalogDate(row.submitted_at) : "",
    validated: row.validated_at ? formatCatalogDate(row.validated_at) : "",
    cancelled: row.cancelled_at ? formatCatalogDate(row.cancelled_at) : "",
    total: row.total_lines, counted: row.counted_lines, recount: row.recount_lines, recounted: row.recounted_lines, id: row.id,
  }));
}

export const catalogueWorkbookColumns: XlsxColumn<ReturnType<typeof catalogueWorkbookRows>[number]>[] = [
  { key: "reference", header: "Référence campagne", width: 40 }, { key: "warehouse", header: "Code dépôt", width: 16 },
  { key: "warehouseName", header: "Dépôt", width: 30 }, { key: "state", header: "État", width: 22 },
  { key: "scope", header: "Périmètre articles", width: 37 },
  { key: "opened", header: "Ouverture", width: 20 }, { key: "updated", header: "Dernière décision", width: 20 },
  { key: "submitted", header: "Soumission", width: 20 }, { key: "validated", header: "Validation", width: 20 },
  { key: "cancelled", header: "Annulation", width: 20 },
  { key: "total", header: "Articles à compter", width: 18 }, { key: "counted", header: "Articles comptés", width: 18 },
  { key: "recount", header: "Recomptages requis", width: 20 }, { key: "recounted", header: "Recomptages saisis", width: 20 },
  { key: "id", header: "Identifiant campagne", width: 43 },
];
