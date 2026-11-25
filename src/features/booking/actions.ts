"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rpcTransport } from "@/lib/supabase/rpc";
import { universityDateTimeInputToIso } from "@/lib/time-format";
import {
  bookingInputSchema,
  bulkReassignInputSchema,
  cancelBookingInputSchema,
  deleteBookingInputSchema,
  evaluatorsInputSchema,
  evaluatorInputSchema,
  periodInputSchema,
  reassignEvaluatorInputSchema,
  removeEvaluatorInputSchema,
  slotCapacityInputSchema,
  slotInputSchema,
  switchBookingInputSchema,
  type ActionResult,
  type EvaluatorInput,
} from "./contracts";
import { bulkSlotsInputSchema, planBulkSlots } from "./bulk-slots";
import { loadPeriodBookingOverview } from "./overview";
import { mapRpcError } from "./rules";

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

  const evaluators = parseEvaluators(emptyToUndefined(formData.get("evaluators")) ?? "[]");
  if (evaluators.error || !evaluators.data) {
    return { ok: false, error: evaluators.error ?? "invalidInput" };
  }

  // datetime-local is a Karachi wall clock, not a server-local instant.
  const startsAt = universityDateTimeInputToIso(parsed.data.startsAt);
  const endsAt = universityDateTimeInputToIso(parsed.data.endsAt);
  if (!startsAt || !endsAt) return { ok: false, error: "invalidInput" };

  // Period + evaluator list + initial seat assignments commit together.
  const { data: periodId, error } = await rpcTransport(supabase).rpc(
    "create_period_with_evaluators",
    {
      p_university_id: profile.university_id,
      p_offering_id: parsed.data.offeringId,
      p_section_id: parsed.data.sectionId,
      p_title: parsed.data.title,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_cutoff_hours: parsed.data.cutoffHours,
      p_evaluators: toRpcEvaluators(evaluators.data),
    },
  );
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePeriod(String(periodId));
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

  const startsAt = universityDateTimeInputToIso(parsed.data.startsAt);
  const endsAt = universityDateTimeInputToIso(parsed.data.endsAt);
  if (!startsAt || !endsAt) return { ok: false, error: "invalidInput" };

  // The RPC creates the seat rows and applies the round-robin in the same
  // transaction as the slot — a direct INSERT would leave the slot seat-less.
  const { error } = await supabase.rpc("create_slot", {
    p_university_id: profile.university_id,
    p_period_id: parsed.data.periodId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_capacity: parsed.data.capacity,
    p_location: parsed.data.location,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePeriod(parsed.data.periodId);
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

/** All evaluator/booking mutations change the same three cached routes. */
function revalidatePeriod(periodId: string): void {
  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${periodId}`);
  revalidatePath("/app");
}

/** JSON editor payload → validated evaluator records (no hardcoded names). */
function parseEvaluators(raw: string): { data?: EvaluatorInput[]; error?: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: "invalidInput" };
  }
  const parsed = evaluatorInputSchema.array().safeParse(json);
  if (!parsed.success || parsed.data.length > 50) return { error: "invalidInput" };

  const ids = parsed.data.filter((item) => item.id).map((item) => item.id);
  const positions = parsed.data.map((item) => item.position);
  if (new Set(ids).size !== ids.length || new Set(positions).size !== positions.length) {
    return { error: "invalidInput" };
  }
  return { data: parsed.data };
}

function toRpcEvaluators(items: EvaluatorInput[]) {
  return items.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    name: item.name,
    email: item.email || null,
    phone: item.phone || null,
    contact_note: item.contactNote || null,
    position: item.position,
  }));
}

/**
 * Non-blocking duplicate warnings computed with the same pure rule the UI uses.
 * They never prevent the mutation — only inform the TA afterwards.
 */
async function reassignmentWarning(
  supabase: Awaited<ReturnType<typeof createClient>>,
  periodId: string,
  change: { bookingId?: string; fromEvaluatorId?: string; toEvaluatorId: string },
): Promise<string | undefined> {
  const overview = await loadPeriodBookingOverview(supabase, periodId);
  if (!overview) return undefined;

  for (const slot of overview.slots) {
    const booked = slot.seats.filter(
      (seat) => seat.booking_id !== null && seat.evaluator_id !== null,
    );
    if (change.bookingId) {
      const target = booked.find((seat) => seat.booking_id === change.bookingId);
      if (!target || target.evaluator_id === change.toEvaluatorId) continue;
      if (
        booked.some((seat) => seat.id !== target.id && seat.evaluator_id === change.toEvaluatorId)
      ) {
        return "duplicateEvaluatorSlot";
      }
    } else if (change.fromEvaluatorId) {
      const moving = booked.some((seat) => seat.evaluator_id === change.fromEvaluatorId);
      if (moving && booked.some((seat) => seat.evaluator_id === change.toEvaluatorId)) {
        return "duplicateEvaluatorSlot";
      }
    }
  }
  return undefined;
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

/**
 * Staff: create, edit, reorder, add or remove evaluators. Existing ids are
 * preserved; removed evaluators are refused while they still have bookings.
 */
export async function saveEvaluatorsAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = evaluatorsInputSchema.safeParse({
    periodId: emptyToUndefined(formData.get("periodId")),
    evaluators: emptyToUndefined(formData.get("evaluators")) ?? "[]",
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const evaluators = parseEvaluators(parsed.data.evaluators);
  if (evaluators.error || !evaluators.data) {
    return { ok: false, error: evaluators.error ?? "invalidInput" };
  }

  const { error } = await rpcTransport(supabase).rpc("save_period_evaluators", {
    p_period_id: parsed.data.periodId,
    p_evaluators: toRpcEvaluators(evaluators.data),
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePeriod(parsed.data.periodId);
  return { ok: true };
}

/** Staff: reassign one booking/seat to a different evaluator. */
export async function reassignEvaluatorAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = reassignEvaluatorInputSchema.safeParse({
    periodId: emptyToUndefined(formData.get("periodId")),
    bookingId: emptyToUndefined(formData.get("bookingId")),
    evaluatorId: emptyToUndefined(formData.get("evaluatorId")),
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const warning = await reassignmentWarning(supabase, parsed.data.periodId, {
    bookingId: parsed.data.bookingId,
    toEvaluatorId: parsed.data.evaluatorId,
  });
  const { error } = await rpcTransport(supabase).rpc("reassign_booking_evaluator", {
    p_booking_id: parsed.data.bookingId,
    p_evaluator_id: parsed.data.evaluatorId,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePeriod(parsed.data.periodId);
  return { ok: true, ...(warning ? { warning } : {}) };
}

/** Staff: move all of one evaluator's bookings to another evaluator. */
export async function bulkReassignEvaluatorAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = bulkReassignInputSchema.safeParse({
    periodId: emptyToUndefined(formData.get("periodId")),
    fromEvaluatorId: emptyToUndefined(formData.get("fromEvaluatorId")),
    toEvaluatorId: emptyToUndefined(formData.get("toEvaluatorId")),
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const warning = await reassignmentWarning(supabase, parsed.data.periodId, {
    fromEvaluatorId: parsed.data.fromEvaluatorId,
    toEvaluatorId: parsed.data.toEvaluatorId,
  });
  const { error } = await rpcTransport(supabase).rpc("bulk_reassign_evaluator", {
    p_period_id: parsed.data.periodId,
    p_from_evaluator_id: parsed.data.fromEvaluatorId,
    p_to_evaluator_id: parsed.data.toEvaluatorId,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePeriod(parsed.data.periodId);
  return { ok: true, ...(warning ? { warning } : {}) };
}

/** Staff: remove an evaluator, moving their bookings to a replacement first. */
export async function removeEvaluatorAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = removeEvaluatorInputSchema.safeParse({
    periodId: emptyToUndefined(formData.get("periodId")),
    evaluatorId: emptyToUndefined(formData.get("evaluatorId")),
    replacementId: emptyToUndefined(formData.get("replacementId")),
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const { error } = await rpcTransport(supabase).rpc("remove_period_evaluator", {
    p_period_id: parsed.data.periodId,
    p_evaluator_id: parsed.data.evaluatorId,
    p_replacement_id: parsed.data.replacementId ?? null,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePeriod(parsed.data.periodId);
  return { ok: true };
}

/** Staff: hard-delete one booking and release its seat. */
export async function deleteBookingAction(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await callerProfile();
  if (!profile) return { ok: false, error: "notAuthorized" };

  const parsed = deleteBookingInputSchema.safeParse({
    periodId: emptyToUndefined(formData.get("periodId")),
    bookingId: emptyToUndefined(formData.get("bookingId")),
  });
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const { error } = await rpcTransport(supabase).rpc("delete_booking", {
    p_booking_id: parsed.data.bookingId,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePeriod(parsed.data.periodId);
  return { ok: true };
}
