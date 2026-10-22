import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { UnderConstruction } from "@/components/states/under-construction";

export const metadata: Metadata = {
  title: "Messages",
};

export default async function MessagesPage() {
  const t = await getTranslations("Nav");
  return <UnderConstruction pageName={t("messages")} />;
}
