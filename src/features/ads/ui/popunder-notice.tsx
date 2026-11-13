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
 * Home-only heads-up about the capped popunder units. Opens on every dashboard
 * visit (owner request 2026-11-13) and keeps no "seen" state: the 4-per-24h cap
 * resets, so the reminder stays useful every time the student lands here.
 */
export function PopunderNotice() {
  const t = useTranslations("Ads.popunderNotice");
  const [open, setOpen] = useState(true);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" data-testid="popunder-notice">
        <header className="grid gap-2 pr-8">
          <DialogTitle className="text-lg font-semibold">{t("title")}</DialogTitle>
          <DialogDescription>{t("body")}</DialogDescription>
        </header>

        <p className="rounded-lg border-2 border-warning/60 bg-warning/15 px-3 py-2 text-sm font-semibold">
          {t("tip")}
        </p>

        <DialogFooter>
          <Button type="button" onClick={() => setOpen(false)} data-testid="popunder-notice-ok">
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
