"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/states/error-state";

export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-16">
      <ErrorState digest={error.digest} onRetry={retry} />
    </main>
  );
}
