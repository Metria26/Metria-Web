"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const t = useTranslations("Auth");

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid="sign-out"
      onClick={async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push("/auth/sign-in");
        router.refresh();
      }}
    >
      {t("signOut")}
    </Button>
  );
}
