import Papa from "papaparse";
import { readXlsx } from "@/lib/xlsx";

/*
 * Lecture d'un fichier tabulaire choisi par l'utilisateur : Excel (.xlsx) ou CSV (séparateur « ; »,
 * « , », tabulation détecté automatiquement). Renvoie les en-têtes de la première ligne et les lignes.
 */
export type TableFile = { name: string; headers: string[]; records: Record<string, string>[] };

export const TABLE_FILE_ACCEPT = ".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function readTableFile(file: File): Promise<TableFile> {
  if (/\.xlsx$/i.test(file.name)) {
    const { headers, records } = await readXlsx(await file.arrayBuffer());
    return { name: file.name, headers, records };
  }
  if (/\.xls$/i.test(file.name)) throw new Error("Ancien format Excel (.xls) : enregistrer le fichier en .xlsx ou en CSV");
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      complete: (res) => resolve({ name: file.name, headers: (res.meta.fields ?? []).filter((h) => h !== ""), records: res.data }),
      error: (e) => reject(new Error(`Fichier illisible : ${e.message}`)),
    });
  });
}
