import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { productName } from "@/lib/brand";

export default async function Home() {
  const t = await getTranslations("Home");

  return (
    <main id="main" className="flex flex-1 flex-col">
      <section className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{productName}</h1>
        <p className="max-w-md text-balance text-muted-foreground sm:text-lg">{t("tagline")}</p>
        <Button render={<Link href="/app" />} nativeButton={false} size="lg">
          {t("ctaOpenApp")}
          <ArrowRight aria-hidden />
        </Button>
      </section>
    </main>
  );
}
