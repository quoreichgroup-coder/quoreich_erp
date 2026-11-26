import { useState } from "react";
import { expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DocumentLinesEditor } from "@/components/DocumentLinesEditor";
import { toLines } from "@/lib/document-lines";

it("links a service to a purchase line and preserves its reference during edits", () => {
  function Editor() {
    const [lines, setLines] = useState([{ description: "", quantity: "1", unitPrice: "1200000" }]);
    return <><DocumentLinesEditor lines={lines} onChange={setLines}
      items={[{ id: "svc", code: "MAINT", name: "Maintenance", item_type: "service" }]} />
      <output data-testid="saved-lines">{JSON.stringify(toLines(lines))}</output></>;
  }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("Article ligne 1"), { target: { value: "svc" } });
  expect(screen.getByLabelText("Libellé ligne 1")).toHaveValue("Maintenance");
  fireEvent.change(screen.getByLabelText("Libellé ligne 1"), { target: { value: "Maintenance annuelle" } });
  expect(JSON.parse(screen.getByTestId("saved-lines").textContent!)).toEqual([
    { item_id: "svc", description: "Maintenance annuelle", quantity: 1, unitPrice: 1200000 },
  ]);
});
