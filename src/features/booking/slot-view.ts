import { karachiDateKey } from "@/lib/time-format";
import type { BookingSlotOverview } from "./overview";

/**
 * Slot display model (registry delta 2026-11-08): slots render as rectangular
 * cards grouped into a separate section per Asia/Karachi day, days and slots
 * sorted ascending, with a Four-state status the card border and badge carry.
 */

export type SlotCardStatus = "booked_by_me" | "full" | "almost_full" | "free" | "cutoff_passed";

export type SlotDayGroup = {
  /** Asia/Karachi calendar date "YYYY-MM-DD" — stable grouping key. */
  key: string;
  slots: BookingSlotOverview[];
};

export function slotStatus(
  slot: Pick<BookingSlotOverview, "booked" | "capacity" | "my_booking_id" | "starts_at">,
  { now = new Date(), cutoffHours }: { now?: Date; cutoffHours: number },
): SlotCardStatus {
  if (slot.my_booking_id) return "booked_by_me";
  // Cancel/booking cutoff (D11): once within cutoffHours of the start the
  // student can no longer act, which overrides the remaining-seat status.
  const cutoffAt = new Date(new Date(slot.starts_at).getTime() - cutoffHours * 3_600_000);
  if (now.getTime() >= cutoffAt.getTime()) return "cutoff_passed";
  if (slot.booked >= slot.capacity) return "full";
  if (slot.capacity > 1 && slot.booked / slot.capacity >= 0.75) return "almost_full";
  return "free";
}

/**
 * Groups slots by Asia/Karachi calendar day, both days and slots ascending.
 * The server already sends slots ordered by starts_at; the second sort keeps
 * the pure helper correct for any future caller.
 */
export function groupSlotsByDay<T extends { starts_at: string; id: string }>(
  slots: readonly T[],
): { key: string; slots: T[] }[] {
  const byKey = new Map<string, { key: string; slots: T[] }>();
  for (const slot of slots) {
    const key = karachiDateKey(slot.starts_at);
    const group = byKey.get(key) ?? { key, slots: [] };
    group.slots.push(slot);
    byKey.set(key, group);
  }
  return [...byKey.values()]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((group) => ({
      key: group.key,
      slots: [...group.slots].sort((a, b) =>
        a.starts_at === b.starts_at ? (a.id < b.id ? -1 : 1) : a.starts_at < b.starts_at ? -1 : 1,
      ),
    }));
}
