import { connection, NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  await connection();

  return NextResponse.json(
    { status: "ok" },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
