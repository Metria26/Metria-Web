import { clientEnv } from "@/lib/env";

/** Product name — never hard-code the brand in reusable UI (design-system.md L9, R6). */
export const productName = clientEnv.NEXT_PUBLIC_PRODUCT_NAME;
