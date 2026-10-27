// Тесты "внешней системы" записи.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BookingService } from "../src/booking-service.js";

// Вторник, 27.10.2026. prebookedShare: 0 — "чужих" записей нет, расписание предсказуемо.
const makeService = (hour = 8, minute = 0) =>
  new BookingService({ now: () => new Date(2026, 9, 27, hour, minute), prebookedShare: 0 });

const patient = { doctorId: "therapist", dateKey: "2026-10-28", time: "10:00", name: "Иван Петров", phone: "+79123456789" };

test("в рабочий день 16 слотов с 09:00 до 16:30, в выходной — ни одного", async () => {
  const service = makeService();
  const slots = await service.getFreeSlots("therapist", "2026-10-28");
  assert.equal(slots.length, 16);
  assert.equal(slots[0], "09:00");
  assert.equal(slots.at(-1), "16:30");
  assert.deepEqual(await service.getFreeSlots("therapist", "2026-10-31"), []); // суббота
});

test("сегодня нельзя записаться на прошедшее время", async () => {
  const service = makeService(12, 10);
  const slots = await service.getFreeSlots("therapist", "2026-10-27");
  assert.equal(slots[0], "12:30");
});

test("занятое время больше не предлагается, повторная запись на него — ошибка", async () => {
  const service = makeService();
  const a = await service.book(patient);
  assert.equal(a.id, "A-1001");
  assert.ok(!(await service.getFreeSlots("therapist", "2026-10-28")).includes("10:00"));
  await assert.rejects(service.book(patient), { code: "SLOT_TAKEN" });
});

test("поиск по телефону, отмена и перенос", async () => {
  const service = makeService();
  const a = await service.book(patient);
  assert.equal((await service.findByPhone(patient.phone)).length, 1);

  const moved = await service.reschedule(a.id, "2026-10-29", "11:00");
  assert.equal(moved.dateKey, "2026-10-29");
  // Старое время освободилось.
  assert.ok((await service.getFreeSlots("therapist", "2026-10-28")).includes("10:00"));

  await service.cancel(a.id);
  assert.equal((await service.findByPhone(patient.phone)).length, 0);
  await assert.rejects(service.cancel(a.id), { code: "NOT_FOUND" });
});

test("занятость «других пациентов» одинакова при каждом запуске", async () => {
  const now = () => new Date(2026, 9, 27, 8, 0);
  const first = await new BookingService({ now }).getFreeSlots("dentist", "2026-10-28");
  const second = await new BookingService({ now }).getFreeSlots("dentist", "2026-10-28");
  assert.deepEqual(first, second);
  assert.ok(first.length < 16); // часть времени занята
});
