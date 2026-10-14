import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Access denied",
  robots: { index: false, follow: false },
};

/** Denied-domain landing target (plan.md F3; no membership is created). */
export default async function AccessDeniedPage() {
  const t = await getTranslations("Auth.accessDenied");

  return (
    <Card data-testid="access-denied-card">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("body")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button render={<Link href="/auth/sign-in" />} nativeButton={false}>
          {t("backToSignIn")}
        </Button>
        <Button render={<Link href="/" />} nativeButton={false} variant="ghost">
          {t("home")}
        </Button>
      </CardContent>
    </Card>
  );
}
