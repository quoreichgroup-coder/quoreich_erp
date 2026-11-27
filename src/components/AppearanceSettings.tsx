import { useTheme } from "next-themes";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import type { RefObject } from "react";
import { useAppearance } from "@/contexts/AppearanceContext";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTranslation } from "react-i18next";

function AppearanceOptions() {
  const { theme, setTheme } = useTheme();
  const { authLayout, setAuthLayout } = useAppearance();
  const { t } = useTranslation();
  return <div className="grid gap-6 py-2">
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-medium">{t("appearance.theme")}</legend>
      <RadioGroup aria-label={t("appearance.theme")} value={theme ?? "system"} onValueChange={setTheme} className="grid grid-cols-3 gap-2">
        {[
          { value: "light", label: t("appearance.theme_light"), Icon: Sun },
          { value: "dark", label: t("appearance.theme_dark"), Icon: Moon },
          { value: "system", label: t("appearance.theme_system"), Icon: Monitor },
        ].map(({ value, label, Icon }) => <Label key={value} htmlFor={`theme-${value}`}
          className="relative flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-input px-2 pb-2 pt-6 text-sm font-normal hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/10 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
          <RadioGroupItem id={`theme-${value}`} value={value} className="absolute left-2 top-2" />
          <Icon aria-hidden="true" className="size-5" />{label}
        </Label>)}
      </RadioGroup>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("appearance.theme_hint")}</p>
    </fieldset>
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-medium">{t("appearance.layout")}</legend>
      <RadioGroup aria-label={t("appearance.layout")} value={authLayout}
        onValueChange={value => { if (value === "essential" || value === "enterprise") setAuthLayout(value); }} className="gap-2">
        {[
          { value: "essential", label: t("appearance.layout_essential"), description: t("appearance.layout_essential_hint") },
          { value: "enterprise", label: t("appearance.layout_enterprise"), description: t("appearance.layout_enterprise_hint") },
        ].map(({ value, label, description }) => <Label key={value} htmlFor={`layout-${value}`}
          className="flex min-h-16 cursor-pointer items-center gap-3 rounded-md border border-input p-3 hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/10">
          <RadioGroupItem id={`layout-${value}`} value={value} />
          <span className="min-w-0"><span className="block text-sm font-medium">{label}</span>
            <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">{description}</span></span>
        </Label>)}
      </RadioGroup>
    </fieldset>
    <p className="text-xs leading-relaxed text-muted-foreground">{t("appearance.persisted")}</p>
  </div>;
}

function AppearanceContent({ returnFocusRef }: { returnFocusRef?: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  return <DialogContent returnFocusRef={returnFocusRef}>
    <DialogHeader><DialogTitle>{t("appearance.title")}</DialogTitle>
      <DialogDescription>{t("appearance.description")}</DialogDescription></DialogHeader>
    <AppearanceOptions />
    <DialogFooter><DialogClose asChild><Button type="button">{t("actions.done")}</Button></DialogClose></DialogFooter>
  </DialogContent>;
}

export function AppearanceButton() {
  const { t } = useTranslation();
  return <Dialog><DialogTrigger asChild>
    <Button type="button" variant="outline" className="gap-2"><Palette aria-hidden="true" />{t("appearance.button")}</Button>
  </DialogTrigger><AppearanceContent /></Dialog>;
}

export function AppearanceDialog({ open, onOpenChange, returnFocusRef }: {
  open: boolean; onOpenChange: (open: boolean) => void; returnFocusRef: RefObject<HTMLElement | null>;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><AppearanceContent returnFocusRef={returnFocusRef} /></Dialog>;
}
