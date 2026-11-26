import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaginationBar, SortableHead } from "../DataTableControls";

afterEach(cleanup);

it("permet de trier une colonne avec Entrée et Espace et annonce le sens actuel", async () => {
  const user = userEvent.setup();
  const sort = vi.fn();
  render(<table><thead><tr>
    <SortableHead label="Montant" sortKey="total" sort={{ key: "total", direction: "asc" }} onSort={sort} />
  </tr></thead></table>);

  const heading = screen.getByRole("columnheader", { name: "Montant" });
  expect(heading).toHaveAttribute("aria-sort", "ascending");
  await user.tab();
  expect(screen.getByRole("button", { name: "Montant" })).toHaveFocus();
  await user.keyboard("{Enter}");
  await user.keyboard(" ");
  expect(sort.mock.calls).toEqual([["total"], ["total"]]);
});

it("nomme les commandes de pagination et empêche de revenir avant la première page", async () => {
  const user = userEvent.setup();
  const changePage = vi.fn();
  render(<PaginationBar page={0} totalPages={3} totalItems={30} pageSize={10} onPageChange={changePage} />);

  expect(screen.getByRole("button", { name: "Page précédente" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await user.click(screen.getByRole("button", { name: "Page suivante" }));
  await user.click(screen.getByRole("button", { name: "Page 3" }));
  expect(changePage.mock.calls).toEqual([[1], [2]]);
});
