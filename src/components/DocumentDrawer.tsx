import type { ReactNode, RefObject } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/** Enveloppe commune de consultation ; le contenu métier reste fourni par chaque module. */
export function DocumentDrawer({ title, description, status, children, footer, onClose, returnFocusRef }: {
  title: string;
  description?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent className="flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-2xl"
      onCloseAutoFocus={event => {
        // Un appelant peut vider cette référence avant de passer à un autre dialogue.
        event.preventDefault();
        if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
      }}>
      <div className="flex min-w-0 shrink-0 flex-wrap items-start justify-between gap-3 border-b p-4 pr-16">
        <div className="min-w-0 flex-1 basis-48 break-words">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription className="mt-1 break-words text-xs">{description || "Détail de la facture"}</SheetDescription>
        </div>
        {status}
      </div>
      <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-auto overscroll-contain p-4">{children}</div>
      {footer && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t p-4 [&_button]:whitespace-normal">{footer}</div>}
    </SheetContent>
  </Sheet>;
}
