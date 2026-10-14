import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async () => {
  // Static locale for the English-only MVP; locale routing is deliberately out
  // of scope (plan.md F4 next-intl scaffold, L12: no hard-coded UI strings).
  const locale = "en";

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
