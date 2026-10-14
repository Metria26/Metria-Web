import { productName } from "@/lib/brand";
import { SignOutButton } from "@/components/shell/sign-out-button";

/** Mobile app header; desktop uses the compact sidebar (design-system.md L11). */
export function AppHeader() {
  return (
    <header
      data-testid="app-header"
      className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
    >
      <span className="truncate text-sm font-semibold">{productName}</span>
      <SignOutButton />
    </header>
  );
}
