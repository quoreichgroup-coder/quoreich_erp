import { describe, expect, it } from "vitest";
import { classifyEvent, detectColumns, parseTrackingRows, type EventCode } from "../shipment-tracking";

const codes: EventCode[] = [
  { code: "LOADED", label: "Chargé à bord", stage: 40, keywords: ["loaded", "chargé"] },
  { code: "DEPARTED", label: "Départ", stage: 50, keywords: ["departed", "départ", "vessel departure"] },
  { code: "ARRIVED", label: "Arrivée", stage: 70, keywords: ["arrived", "arrivée", "vessel arrival"] },
  { code: "GATE_IN", label: "Entrée terminal", stage: 30, keywords: ["gate in"] },
  { code: "GATE_OUT", label: "Sortie du terminal", stage: 110, keywords: ["gate out", "sortie terminal"] },
  { code: "CUSTOMS_RELEASED", label: "Mainlevée", stage: 100, keywords: ["mainlevée", "bon à enlever", "released"] },
];

describe("suivi des expéditions : lecture d'un fichier de suivi", () => {
  it("reconnaît les colonnes en français et en anglais", () => {
    expect(detectColumns(["Date", "Événement", "Lieu", "Navire", "Conteneur"])).toMatchObject({ date: 0, event: 1, location: 2, vessel: 3, container: 4 });
    expect(detectColumns(["Event date", "Status", "Location", "Vessel name", "Container number"])).toMatchObject({ date: 0, event: 1, location: 2, vessel: 3, container: 4 });
  });

  it("reconnaît l'étape par son libellé, le mot-clé le plus long l'emportant", () => {
    expect(classifyEvent("Vessel departure from Ningbo", codes)).toBe("DEPARTED");
    expect(classifyEvent("Full container GATE OUT", codes)).toBe("GATE_OUT");
    expect(classifyEvent("Mainlevée accordée (BAE)", codes)).toBe("CUSTOMS_RELEASED");
    expect(classifyEvent("Chargé à bord", codes)).toBe("LOADED");
    expect(classifyEvent("Inspection phytosanitaire", codes)).toBeNull();
  });

  it("lit les lignes : date française, conteneur ISO, estimé ou réel, ligne vide ignorée", () => {
    const rows = parseTrackingRows([
      ["Date", "Événement", "Lieu", "Navire", "Conteneur"],
      ["10/05/2031 14:30", "Vessel departure", "CNNGB", "MSC ANNA", "mscu 1234567"],
      ["", "", "", "", ""],
      ["2031-07-05", "Arrivée estimée (ETA)", "CIABJ", "MSC ANNA", ""],
      ["12/07/2031", "Inspection", "CIABJ", "", "ABC"],
    ], codes);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ line: 2, event_code: "DEPARTED", event_at: "2031-05-10", event_class: "actual", container_number: "MSCU1234567", vessel: "MSC ANNA" });
    expect(rows[1]).toMatchObject({ event_code: "ARRIVED", event_at: "2031-07-05", event_class: "estimated" });
    expect(rows[2]).toMatchObject({ event_code: null, container_number: null });
  });
});
