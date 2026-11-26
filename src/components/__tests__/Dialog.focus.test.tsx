import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../ui/dialog";

afterEach(cleanup);

it("restitue le focus au DialogTrigger même si le clic d'ouverture ne lui donne pas le focus", async () => {
  const user = userEvent.setup();
  render(<Dialog>
    <DialogTrigger>Ouvrir la fenêtre</DialogTrigger>
    <DialogContent>
      <DialogTitle>Pièce</DialogTitle>
      <DialogDescription>Détail de la pièce.</DialogDescription>
    </DialogContent>
  </Dialog>);
  const trigger = screen.getByRole("button", { name: "Ouvrir la fenêtre" });
  // Sur Safari, le clic sur un bouton peut laisser le focus sur body.
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByRole("button", { name: "Fermer la fenêtre" })).toHaveFocus());
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
});
