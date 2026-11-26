import { cn } from "@/lib/utils";

/** Identité du produit QERP ; l'identité légale de la société reste indépendante. */
export function AppLogo({ inverse = false, className }: { inverse?: boolean; className?: string }) {
  return <img
    src="/branding/qerp-logo-v1.png"
    alt="QERP"
    width={2206}
    height={713}
    className={cn("block h-auto w-36 max-w-full shrink-0", inverse && "brightness-0 invert", className)}
  />;
}
