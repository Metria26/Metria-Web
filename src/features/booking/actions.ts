"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rpcTransport } from "@/lib/supabase/rpc";
import {
  bookingInputSchema,
  cancelBookingInputSchema,
  periodInputSchema,
  slotCapacityInputSchema,
  slotInputSchema,
  switchBookingInputSchema,
  type ActionResult,
} from "./contracts";
import { bulkSlotsInputSchema, planBulkSlots } from "./bulk-slots";
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formUuid(formData: FormData, key: string): string | null {
  const value = emptyToUndefined(formData.get(key));
  return value && uuidPattern.test(value) ? value : null;
}

/**
 * Staff: atomically generate slots across a date range (or a per-day slot
 * count) through private.create_slots_bulk — permission, period window,
 * overlap and the 500-slot cap are all enforced server-side; the client
 * preview (planBulkSlots) is cosmetic.
 */
export async function generateSlotsAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = bulkSlotsInputSchema.safeParse({
    periodId: emptyToUndefined(formData.get("periodId")),
    fromDate: emptyToUndefined(formData.get("fromDate")),
    toDate: emptyToUndefined(formData.get("toDate")),
    dailyStart: emptyToUndefined(formData.get("dailyStart")),
    dailyEnd: emptyToUndefined(formData.get("dailyEnd")) ?? "",
    slotsPerDay: emptyToUndefined(formData.get("slotsPerDay")),
    slotMinutes: emptyToUndefined(formData.get("slotMinutes")),
    gapMinutes: emptyToUndefined(formData.get("gapMinutes")) ?? 0,
    capacity: emptyToUndefined(formData.get("capacity")),
    location: emptyToUndefined(formData.get("location")) ?? "",
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const plan = planBulkSlots(parsed.data);
  if (!plan.ok) return { ok: false, error: plan.error };

  const { error } = await supabase.rpc("create_slots_bulk", {
    p_university_id: profile.university_id,
    p_period_id: parsed.data.periodId,
    p_from_date: parsed.data.fromDate,
    p_to_date: parsed.data.toDate,
    p_daily_start: parsed.data.dailyStart.slice(0, 5),
    p_daily_end: parsed.data.dailyEnd ? parsed.data.dailyEnd.slice(0, 5) : null,
    p_slot_minutes: parsed.data.slotMinutes,
    p_gap_minutes: parsed.data.gapMinutes,
    p_capacity: parsed.data.capacity,
    p_location: parsed.data.location.length > 0 ? parsed.data.location : null,
    p_slots_per_day: parsed.data.slotsPerDay ?? null,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePath(`/app/bookings/${parsed.data.periodId}`);
  revalidatePath("/app/bookings");
  return { ok: true };
}

/**
 * Student: move their active booking in this period to another free slot in
 * one atomic RPC (cancel + create in one transaction; a full target rolls the
 * whole thing back so the old booking stays).
 */
export async function switchSlotAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = switchBookingInputSchema.safeParse({
    periodId: emptyToUndefined(formData.get("periodId")),
    targetSlotId: emptyToUndefined(formData.get("targetSlotId")),
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const { error } = await supabase.rpc("switch_booking", {
    p_period_id: parsed.data.periodId,
    p_target_slot_id: parsed.data.targetSlotId,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePath(`/app/bookings/${parsed.data.periodId}`);
  revalidatePath("/app/bookings");
  revalidatePath("/app");
  return { ok: true };
}

/** Staff: raise a slot's capacity (the RPC refuses cutting below bookings). */
export async function updateSlotCapacityAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = slotCapacityInputSchema.safeParse({
    slotId: emptyToUndefined(formData.get("slotId")),
    capacity: emptyToUndefined(formData.get("capacity")),
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const { error } = await supabase.rpc("update_slot_capacity", {
    p_slot_id: parsed.data.slotId,
    p_capacity: parsed.data.capacity,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePath("/app/bookings");
  return { ok: true };
}

/** Staff: delete a period and its slots, bookings and waitlist entries. */
export async function deletePeriodAction(formData: FormData): Promise<ActionResult> {
  const periodId = formUuid(formData, "periodId");
  if (!periodId) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await rpcTransport(supabase).rpc("delete_evaluation_period", {
    p_period_id: periodId,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };
  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${periodId}`);
  revalidatePath("/app");
  return { ok: true };
}

/** Staff: delete one slot and its bookings/waitlist entries. */
export async function deleteSlotAction(formData: FormData): Promise<ActionResult> {
  const slotId = formUuid(formData, "slotId");
  const periodId = formUuid(formData, "periodId");
  if (!slotId || !periodId) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await rpcTransport(supabase).rpc("delete_slot", { p_slot_id: slotId });
  if (error) return { ok: false, error: mapRpcError(error.message) };
  revalidatePath(`/app/bookings/${periodId}`);
  revalidatePath("/app/bookings");
  return { ok: true };
}
