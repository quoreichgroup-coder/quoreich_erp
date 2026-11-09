import { Info, X } from "lucide-react";
import { useState } from "react";

export function GuidanceBanner({ message, title, description }: { message?: string; title?: string; description?: string }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  const text = message || (title && description ? `${title} — ${description}` : title || description || "");

  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5 rounded-md border border-border bg-muted/50 text-xs text-muted-foreground">
      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span className="flex-1">{text}</span>
      <button onClick={() => setVisible(false)} className="p-0.5 hover:text-foreground transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
