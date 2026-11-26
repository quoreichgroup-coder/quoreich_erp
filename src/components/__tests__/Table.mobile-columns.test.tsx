import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/table";

afterEach(cleanup);

function SelectionCell() {
  return <TableCell><input type="checkbox" aria-label="Sélectionner la demande" /></TableCell>;
}

it("associe les légendes aux bonnes cellules à travers un composant de sélection", () => {
  render(<Table mobileColumns={[
    { label: "Sélection", kind: "selection" }, { label: "Référence", kind: "primary" }, { label: "Objet", wide: true },
  ]}>
    <TableBody><TableRow><SelectionCell /><TableCell>PR-001</TableCell><TableCell>Maintenance</TableCell></TableRow></TableBody>
  </Table>);
  const cells = screen.getAllByRole("cell");
  expect(within(cells[1]).getByText("Référence")).toBeInTheDocument();
  expect(within(cells[2]).getByText("Objet")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Sélectionner la demande" })).toBeInTheDocument();
});

it("ne transforme pas un état vide fusionné en champ ou contrôle de sélection", () => {
  render(<Table mobileColumns={[{ label: "Sélection", kind: "selection" }, { label: "Référence" }]}>
    <TableBody><TableRow><TableCell colSpan={2}>Aucune demande</TableCell></TableRow></TableBody>
  </Table>);
  expect(screen.getByText("Aucune demande")).toBeInTheDocument();
  expect(screen.queryByText("Sélectionner")).not.toBeInTheDocument();
});

it("conserve un tableau ordinaire quand aucune colonne mobile n'est fournie", () => {
  render(<Table><TableHeader><TableRow><TableHead>Objet</TableHead></TableRow></TableHeader>
    <TableBody><TableRow><TableCell>Maintenance</TableCell></TableRow></TableBody>
  </Table>);
  expect(screen.getByRole("cell")).toHaveTextContent(/^Maintenance$/);
  expect(screen.getAllByText("Objet")).toHaveLength(1);
});
