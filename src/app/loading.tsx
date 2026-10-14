import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main
      id="main"
      role="status"
      aria-busy="true"
      className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16"
    >
      <Skeleton className="h-9 w-48" aria-hidden />
      <Skeleton className="h-5 w-72 max-w-full" aria-hidden />
      <Skeleton className="h-10 w-36" aria-hidden />
    </main>
  );
}
