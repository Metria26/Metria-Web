"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  bookingInputSchema,
  cancelBookingInputSchema,
  periodInputSchema,
  slotInputSchema,
  type ActionResult,
} from "./contracts";
import { mapRpcError, mapWriteError } from "./rules";

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolves the caller's profile row (id + tenant). RLS gates this read:
 * profiles_self_read (T-A004) makes the caller's own row always visible, so a
 * missing row means the session has no provisioned profile.
 */
async function callerProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, university_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return { supabase, profile: profile ?? null };
}

/** Staff creates a period for an offering they staff (RLS enforces both). */
export async function createPeriodAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = periodInputSchema.safeParse({
    offeringId: emptyToUndefined(formData.get("offeringId")),
    sectionId: emptyToUndefined(formData.get("sectionId")),
    title: emptyToUndefined(formData.get("title")),
    startsAt: emptyToUndefined(formData.get("startsAt")),
    endsAt: emptyToUndefined(formData.get("endsAt")),
    cutoffHours: emptyToUndefined(formData.get("cutoffHours")) ?? 6,
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const { error } = await supabase.from("evaluation_periods").insert({
    university_id: profile.university_id,
    created_by: profile.id,
    offering_id: parsed.data.offeringId,
    section_id: parsed.data.sectionId,
    title: parsed.data.title,
    starts_at: new Date(parsed.data.startsAt).toISOString(),
    ends_at: new Date(parsed.data.endsAt).toISOString(),
    cutoff_hours: parsed.data.cutoffHours,
  });
  if (error) return { ok: false, error: mapWriteError(error.code) };

  revalidatePath("/app/bookings");
  return { ok: true };
}

/** Staff adds a slot to a period of an offering they staff (RLS enforces). */
export async function createSlotAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = slotInputSchema.safeParse({
    periodId: emptyToUndefined(formData.get("periodId")),
    startsAt: emptyToUndefined(formData.get("startsAt")),
    endsAt: emptyToUndefined(formData.get("endsAt")),
    capacity: emptyToUndefined(formData.get("capacity")),
    location: emptyToUndefined(formData.get("location")) ?? "",
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const { error } = await supabase.from("slots").insert({
    university_id: profile.university_id,
    created_by: profile.id,
    period_id: parsed.data.periodId,
    starts_at: new Date(parsed.data.startsAt).toISOString(),
    ends_at: new Date(parsed.data.endsAt).toISOString(),
    capacity: parsed.data.capacity,
    location: parsed.data.location.length > 0 ? parsed.data.location : null,
  });
  if (error) return { ok: false, error: mapWriteError(error.code) };

  revalidatePath(`/app/bookings/${parsed.data.periodId}`);
  return { ok: true };
}

/**
 * Student books a slot through the atomic RPC (P19): capacity, one active
 * booking per period and enrollment are enforced inside private.book_slot.
 */
export async function bookSlotAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = bookingInputSchema.safeParse({
    periodId: emptyToUndefined(formData.get("periodId")),
    slotId: emptyToUndefined(formData.get("slotId")),
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const { error } = await supabase.rpc("book_slot", {
    p_university_id: profile.university_id,
    p_period_id: parsed.data.periodId,
    p_slot_id: parsed.data.slotId,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${parsed.data.periodId}`);
  revalidatePath("/app");
  return { ok: true };
}

/** Student cancels their own booking while the per-period cutoff allows it. */
export async function cancelBookingAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = cancelBookingInputSchema.safeParse({
    bookingId: emptyToUndefined(formData.get("bookingId")),
    periodId: emptyToUndefined(formData.get("periodId")),
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const { error } = await supabase.rpc("cancel_booking", {
    p_booking_id: parsed.data.bookingId,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${parsed.data.periodId}`);
  revalidatePath("/app");
  return { ok: true };
}
