"use client";

import { NextIntlClientProvider, useTranslations } from "next-intl";
import messages from "../../messages/en.json";

function GlobalErrorFallback({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("States.error");

  return (
    <main
      id="main"
      style={{
        fontFamily: "system-ui, sans-serif",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
        background: "Canvas",
        color: "CanvasText",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>{t("title")}</h1>
      <p style={{ margin: 0, opacity: 0.75 }}>{t("body")}</p>
      <p style={{ margin: 0, fontSize: "0.75rem", opacity: 0.75 }}>
        {t("correlation")}: <code>{error.digest ?? "—"}</code>
      </p>
      <button
        onClick={() => retry()}
        style={{
          height: "2.5rem",
          padding: "0 1.25rem",
          borderRadius: "0.5rem",
          border: "none",
          background: "CanvasText",
          color: "Canvas",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        {t("retry")}
      </button>
    </main>
  );
}

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // Replaces the root layout entirely: no global CSS or providers available,
  // so messages are imported directly and styling is inline (next-intl docs).
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <NextIntlClientProvider locale="en" messages={messages}>
          <GlobalErrorFallback error={error} retry={retry} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
