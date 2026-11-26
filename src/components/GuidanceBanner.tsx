import { Info, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function GuidanceBanner({ message, title, description }: { message?: string; title?: string; description?: string }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  const text = message || (title && description ? `${title} — ${description}` : title || description || "");

  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5 rounded-md border border-border bg-muted/50 text-xs text-muted-foreground">
      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      <Button type="button" variant="ghost" size="compact" aria-label="Masquer l'aide" onClick={() => setVisible(false)} className="-mr-2 -mt-1 size-8 shrink-0 p-0">
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
