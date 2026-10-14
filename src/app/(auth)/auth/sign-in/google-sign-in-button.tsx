"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/** Starts the Supabase Google OAuth flow (plan.md F3). */
export function GoogleSignInButton({ next }: { next: string }) {
  const t = useTranslations("Auth.signIn");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        data-testid="google-sign-in"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setFailed(false);
          const supabase = createClient();
          const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
            },
          });
          if (error) {
            setPending(false);
            setFailed(true);
          }
        }}
      >
        {t("continueWithGoogle")}
      </Button>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("failed")}
        </p>
      ) : null}
    </div>
  );
}
