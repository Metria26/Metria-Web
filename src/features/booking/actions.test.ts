import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySlotRestructureAction } from "./actions";
import {
  defaultDayInputs,
  previewRestructure,
  restructureRpcPayload,
  type RestructureData,
} from "./restructure";

const { rpc, createClient, revalidatePath } = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const MONDAY = "2026-11-30";
const WEDNESDAY = "2026-12-02";
const PERIOD_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function iso(day: string, time: string): string {
  return `${day}T${time}:00+05:00`;
}

function uuid(prefix: string, index: number): string {
  return `${prefix}-1111-4111-8111-${String(index).padStart(12, "0")}`;
}

/** Exactly the reviewed scenario: 13 students Monday, 4 on Wednesday. */
function scenario(): RestructureData {
  const mondayTimes = [
    ["13:10", "13:25"],
    ["13:25", "13:40"],
    ["13:40", "13:55"],
    ["13:55", "14:10"],
  ] as const;
  const slots = [
    ...mondayTimes.map(([start, end], index) => ({
      id: uuid("aaaaaaaa", index + 1),
      starts_at: iso(MONDAY, start),
      ends_at: iso(MONDAY, end),
      capacity: 4,
      location: "Lab A",
    })),
    {
      id: uuid("bbbbbbbb", 1),
      starts_at: iso(WEDNESDAY, "13:00"),
      ends_at: iso(WEDNESDAY, "13:15"),
      capacity: 4,
      location: "Lab B",
    },
  ];
  const student = (index: number, prefix: string, day: string, start: string) => ({
    bookingId: uuid(prefix, index + 1),
    studentId: uuid("cccccccc", index + 1),
    studentName: `Student ${index + 1} BS(CS) 2025 FAST NU LHR`,
    rollNo: null,
    email: `l2506${String(index + 1).padStart(2, "0")}@student.example.com`,
    slotId: slots[start === "13:00" ? 4 : Math.floor(index / 4)]!.id,
    slotStartsAt: iso(day, start),
    seatNumber: start === "13:00" ? index + 1 : (index % 4) + 1,
    evaluatorId: null,
    evaluatorName: null,
    createdAt: new Date(Date.parse(iso(day, "09:00")) + index * 1000).toISOString(),
  });
  const students = [
    ...mondayTimes.flatMap(([start], slotIndex) =>
      Array.from({ length: slotIndex === 3 ? 1 : 4 }, (_, seat) =>
        student(slotIndex * 4 + seat, "dddddddd", MONDAY, start),
      ),
    ),
    ...Array.from({ length: 4 }, (_, index) =>
      student(index, "eeeeeeeeee".slice(0, 8), WEDNESDAY, "13:00"),
    ),
  ];

  return {
    period: { id: PERIOD_ID, title: "Midterm evaluation", slotMinutes: 15, capacity: 4 },
    slots,
    students,
    evaluators: [],
  };
}

function formDataForScenario(): FormData {
  const data = scenario();
  const options = {
    slotMinutes: 15,
    capacity: 4,
    keepEvaluator: true,
    fillAfterLast: true,
    days: defaultDayInputs(data).map((day) =>
      day.key === MONDAY
        ? { ...day, start: "13:10", end: "14:10" }
        : { ...day, start: "13:00", end: "13:30" },
    ),
  };
  const preview = previewRestructure(data, options);
  expect(preview.canApply).toBe(true);
  const payload = restructureRpcPayload(preview, options);

  const formData = new FormData();
  formData.set("periodId", data.period.id);
  formData.set("slotMinutes", String(options.slotMinutes));
  formData.set("capacity", String(options.capacity));
  formData.set("keepEvaluator", String(options.keepEvaluator));
  formData.set("fillAfterLast", String(options.fillAfterLast));
  formData.set("days", JSON.stringify(payload.days));
  formData.set("plan", JSON.stringify(payload.plan));
  return formData;
}

describe("applySlotRestructureAction", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockReset();
    revalidatePath.mockReset();
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth-1" } } }) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { id: "profile-1", university_id: "university-1" } }),
          })),
        })),
      })),
      rpc,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("sends the exact previewed scenario to the transactional RPC", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });

    const result = await applySlotRestructureAction(formDataForScenario());

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("apply_slot_restructure");
    expect(args).toMatchObject({
      p_period_id: PERIOD_ID,
      p_slot_minutes: 15,
      p_capacity: 4,
      p_keep_evaluator: true,
      p_fill_after_last: true,
    });
    expect(args.p_days).toHaveLength(2);
    expect(args.p_plan).toHaveLength(17);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("returns the raw database diagnostic when the RPC error is unmapped", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "period_slot_restructures" does not exist',
        code: "42P01",
        details: null,
        hint: null,
      },
    });

    const result = await applySlotRestructureAction(formDataForScenario());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("generic");
      expect(result.detail).toContain("period_slot_restructures");
    }
    expect(console.error).toHaveBeenCalledWith(
      "[applySlotRestructure] RPC failed",
      expect.objectContaining({ code: "42P01" }),
    );
  });
});
