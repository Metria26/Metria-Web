import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleSignInButton } from "./google-sign-in-button";
import { safeNextPath } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // searchParams must be awaited inside a Suspense boundary (Next 16 instant
  // navigation validation): the card shell prerenders; the button streams in.
  return (
    <Suspense fallback={<Card data-testid="sign-in-card" className="min-h-44" />}>
      <SignInCard searchParams={searchParams} />
    </Suspense>
  );
}

async function SignInCard({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const t = await getTranslations("Auth.signIn");

  return (
    <Card data-testid="sign-in-card">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <GoogleSignInButton next={safeNextPath(next ?? null)} />
      </CardContent>
    </Card>
  );
}
