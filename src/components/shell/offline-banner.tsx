"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { WifiOffIcon } from "lucide-react";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

/**
 * Offline shell banner (design-system.md L13): explains that shown content is
 * cached. Enforcement that unsafe mutations are blocked while offline lands
 * with the mutation forms (T-A002+) and the PWA card (T-A012).
 */
export function OfflineBanner() {
  const t = useTranslations("States.offline");
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (online) return null;

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="border-b border-warning/40 bg-warning px-4 py-2 text-center text-sm text-warning-foreground"
    >
      <span className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <WifiOffIcon className="size-4" aria-hidden />
          {t("title")}
        </span>
        <span>{t("body")}</span>
      </span>
    </div>
  );
}
