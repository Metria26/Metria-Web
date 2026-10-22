import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { UnderConstruction } from "@/components/states/under-construction";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfilePage() {
  const t = await getTranslations("Nav");
  return <UnderConstruction pageName={t("profile")} />;
}
