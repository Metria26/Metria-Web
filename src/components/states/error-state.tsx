"use client";

import { useTranslations } from "next-intl";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ErrorState({ digest, onRetry }: { digest?: string; onRetry: () => void }) {
  const t = useTranslations("States.error");

  return (
    <Card role="alert" className="w-full max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleAlertIcon className="size-5 text-destructive" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("body")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{t("correlation")}:</span>{" "}
          <code className="font-mono text-xs break-all">{digest ?? "—"}</code>
        </p>
        <Button onClick={onRetry} className="w-fit">
          {t("retry")}
        </Button>
      </CardContent>
    </Card>
  );
}
