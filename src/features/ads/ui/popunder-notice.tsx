"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Home-only heads-up about the capped popunder units. Opens on every landing
 * page visit (owner request 2026-11-13) and keeps no "seen" state: the 4-per-24h
 * cap resets, so the reminder stays useful every time a student lands here.
 */
export function PopunderNotice() {
  const t = useTranslations("Ads.popunderNotice");
  const [open, setOpen] = useState(true);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl" data-testid="popunder-notice">
        <header className="grid gap-3 pr-8">
          <DialogTitle className="text-2xl font-bold tracking-tight">{t("title")}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed sm:text-lg">
            {t("body")}
          </DialogDescription>
        </header>

        <div className="grid gap-2 rounded-xl border-2 border-warning/60 bg-warning/15 p-4">
          <p className="text-base leading-relaxed sm:text-lg">
            <span className="font-bold">{t("tipLead")}</span> {t("tipBefore")}{" "}
            <kbd className="rounded-md border bg-background px-2.5 py-1 font-mono text-sm font-bold sm:text-base">
              CTRL
            </kbd>
            {" + "}
            <kbd className="rounded-md border bg-background px-2.5 py-1 font-mono text-sm font-bold sm:text-base">
              W
            </kbd>{" "}
            {t("tipAfter")}
          </p>
          <p className="text-sm text-muted-foreground sm:text-base">{t("macTip")}</p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={() => setOpen(false)}
            data-testid="popunder-notice-ok"
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
