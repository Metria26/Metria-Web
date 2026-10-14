"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { productName } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { SignOutButton } from "./sign-out-button";
import { sidebarNav } from "./nav-items";

/** Compact desktop sidebar (design-system.md L11); mobile uses bottom nav. */
export function AppSidebar() {
  const pathname = usePathname();
  const t = useTranslations("Nav");
  const tShell = useTranslations("Shell");

  return (
    <aside
      data-testid="sidebar"
      aria-label={tShell("sidebarNav")}
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r bg-sidebar md:flex"
    >
      <div className="flex h-14 items-center border-b px-4">
        <span className="truncate text-sm font-semibold text-sidebar-foreground">
          {productName}
        </span>
      </div>
      <nav
        aria-label={tShell("primaryNav")}
        className="flex flex-1 flex-col gap-1 overflow-y-auto p-2"
      >
        {sidebarNav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-2">
        <SignOutButton />
      </div>
    </aside>
  );
}
