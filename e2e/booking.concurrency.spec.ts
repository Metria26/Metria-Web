import { expect, test } from "@playwright/test";
import {
  E2E_EMAIL,
  E2E_STUDENT2_EMAIL,
  ensureE2EStudent2,
  ensureE2EUser,
  ensureEnrollment,
  fixtureProfile,
  passwordGrantToken,
  rpcAs,
  serviceRest,
} from "./helpers/auth";

/**
 * T-A006 / P19 capacity race at the database layer: two students fire
 * `book_slot` at the same instant for the last seat of a capacity-1 slot.
 * The period-row lock plus the capacity check must admit exactly one booking
 * (a trigger re-checks as safety net). Fixture data is created over the
 * service role; the two bookings go through PostgREST with real user JWTs so
 * the entire production path (RLS + RPC + trigger) is exercised.
 */
test.describe("booking capacity race", () => {
  test.describe.configure({ mode: "serial" });

  async function fastFixtures(): Promise<{
    universityId: string;
    offeringId: string;
    sectionId: string;
  }> {
    const offerings = await serviceRest<{ id: string; university_id: string }[]>(
      "course_offerings?offering_code=eq.CS301-F26&select=id,university_id",
    );
    const offering = offerings[0];
    if (!offering) throw new Error("seeded CS301-F26 offering not found");
    const sections = await serviceRest<{ id: string }[]>(
      `sections?offering_id=eq.${offering.id}&section_code=eq.A&select=id`,
    );
    const section = sections[0];
    if (!section) throw new Error("seeded CS301-F26 section A not found");
    return {
      universityId: offering.university_id,
      offeringId: offering.id,
      sectionId: section.id,
    };
  }

  async function createPeriodWithSlot(
    universityId: string,
    offeringId: string,
    sectionId: string,
    title: string,
    capacity: number,
  ): Promise<{ periodId: string; slotId: string }> {
    const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const endsAt = new Date(Date.now() + 4 * 86_400_000).toISOString();
    const periodRows = await serviceRest<{ id: string }[]>("evaluation_periods", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        university_id: universityId,
        offering_id: offeringId,
        section_id: sectionId,
        title,
        starts_at: startsAt,
        ends_at: endsAt,
        cutoff_hours: 6,
      }),
    });
    const periodId = periodRows[0]?.id;
    if (!periodId) throw new Error("e2e period creation returned no row");

    const slotStarts = new Date(Date.now() + 3 * 86_400_000 + 3_600_000);
    const slotEnds = new Date(slotStarts.getTime() + 15 * 60_000);
    const slotRows = await serviceRest<{ id: string }[]>("slots", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        university_id: universityId,
        period_id: periodId,
        starts_at: slotStarts.toISOString(),
        ends_at: slotEnds.toISOString(),
        capacity,
        location: "E2E RC lab",
      }),
    });
    const slotId = slotRows[0]?.id;
    if (!slotId) throw new Error("e2e slot creation returned no row");
    return { periodId, slotId };
  }

  test.beforeAll(async () => {
    await ensureE2EUser();
    await ensureE2EStudent2();
  });

  test("two simultaneous bookings of the last seat leave exactly one winner", async () => {
    test.setTimeout(60_000);
    const stamp = Date.now().toString(36).toUpperCase();
    const { universityId, offeringId, sectionId } = await fastFixtures();

    const student1 = await fixtureProfile(E2E_EMAIL);
    const student2 = await fixtureProfile(E2E_STUDENT2_EMAIL);
    await ensureEnrollment(student1, sectionId);
    await ensureEnrollment(student2, sectionId);

    const { periodId, slotId } = await createPeriodWithSlot(
      universityId,
      offeringId,
      sectionId,
      `E2E race ${stamp}`,
      1,
    );

    const [token1, token2] = await Promise.all([
      passwordGrantToken(E2E_EMAIL),
      passwordGrantToken(E2E_STUDENT2_EMAIL),
    ]);

    const args = {
      p_university_id: universityId,
      p_period_id: periodId,
      p_slot_id: slotId,
    };
    const [first, second] = await Promise.all([
      rpcAs(token1, "book_slot", args),
      rpcAs(token2, "book_slot", args),
    ]);

    const wins = [first, second].filter((result) => result.ok);
    const losses = [first, second].filter((result) => !result.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0]?.message).toBe("slot_full");

    // The database agrees: exactly one active booking on the slot.
    const bookings = await serviceRest<{ id: string; student_id: string }[]>(
      `bookings?slot_id=eq.${slotId}&status=eq.active&select=id,student_id`,
    );
    expect(bookings).toHaveLength(1);
    expect([student1.id, student2.id]).toContain(bookings[0]?.student_id);
  });

  test("two simultaneous bookings with capacity to spare are both admitted", async () => {
    test.setTimeout(60_000);
    const stamp = Date.now().toString(36).toUpperCase();
    const { universityId, offeringId, sectionId } = await fastFixtures();

    const { periodId, slotId } = await createPeriodWithSlot(
      universityId,
      offeringId,
      sectionId,
      `E2E pair ${stamp}`,
      2,
    );

    const [token1, token2] = await Promise.all([
      passwordGrantToken(E2E_EMAIL),
      passwordGrantToken(E2E_STUDENT2_EMAIL),
    ]);

    const args = {
      p_university_id: universityId,
      p_period_id: periodId,
      p_slot_id: slotId,
    };
    const [first, second] = await Promise.all([
      rpcAs(token1, "book_slot", args),
      rpcAs(token2, "book_slot", args),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const bookings = await serviceRest<{ id: string }[]>(
      `bookings?slot_id=eq.${slotId}&status=eq.active&select=id`,
    );
    expect(bookings).toHaveLength(2);
  });
});
