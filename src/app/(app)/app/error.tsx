"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/states/error-state";

export default function AppError({
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
    <div className="flex justify-center py-8">
      <ErrorState digest={error.digest} onRetry={retry} />
    </div>
  );
}
