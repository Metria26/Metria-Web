"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { productName } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { SignOutButton } from "./sign-out-button";
import { sidebarNav } from "./nav-items";

/** Modern, collapsible desktop sidebar with smooth transitions and polished aesthetics. */
export function AppSidebar() {
  const pathname = usePathname();
  const t = useTranslations("Nav");
  const tShell = useTranslations("Shell");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      data-testid="sidebar"
      aria-label={tShell("sidebarNav")}
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-card/60 backdrop-blur-xl transition-all duration-300 ease-in-out md:flex shadow-sm z-30",
        collapsed ? "w-20" : "w-64",
      )}
    >
      {/* Sidebar Header / Logo + Collapse Toggle */}
      <div className="flex h-16 items-center justify-between border-b px-4">
        {!collapsed && (
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold shadow-sm">
              M
            </div>
            <span className="truncate text-base font-semibold tracking-tight text-foreground">
              {productName}
            </span>
          </div>
        )}
        {collapsed && (
          <div className="mx-auto flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold shadow-sm">
            M
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "flex size-7 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground",
            collapsed && "mx-auto mt-2",
          )}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>

      {/* Navigation Items */}
      <nav
        aria-label={tShell("primaryNav")}
        className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-3"
      >
        {sidebarNav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? t(item.key) : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                active
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                collapsed && "justify-center px-2",
              )}
            >
              <Icon
                className={cn(
                  "size-5 shrink-0 transition-transform group-hover:scale-110",
                  active && "text-primary-foreground",
                )}
                aria-hidden
              />
              {!collapsed && <span className="truncate">{t(item.key)}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer / Sign Out */}
      <div className="border-t p-3">
        {collapsed ? (
          <div className="flex justify-center">
            <SignOutButton />
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium px-1">Workspace</span>
            <SignOutButton />
          </div>
        )}
      </div>
    </aside>
  );
}
