"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
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
        // Hard reload: a popunder listener must not survive into /auth/*.
        window.location.replace("/auth/sign-in");
      }}
    >
      {t("signOut")}
    </Button>
  );
}
