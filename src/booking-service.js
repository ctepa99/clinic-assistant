// "Внешняя система" записи — то, что в реальном проекте было бы API медицинской
// информационной системы клиники. Здесь данные хранятся в памяти, но методы
// асинхронные (возвращают Promise), как при настоящих сетевых запросах.
// Ассистент общается с системой только через эти методы, поэтому заменить
// имитацию на настоящий API можно, не трогая логику диалога.

import { DOCTORS, SCHEDULE } from "./clinic-data.js";
import { addDays, fromKey, startOfDay, timeOfDay, timeSlots, toKey } from "./dates.js";

// Ошибка с кодом: по коду ассистент понимает, что случилось, и отвечает человеку.
export class BookingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BookingError";
    this.code = code; // "SLOT_TAKEN", "NOT_FOUND", "UNKNOWN_DOCTOR"
  }
}

// Простой хеш строки (djb2): одна и та же строка всегда даёт одно и то же число.
function hash(text) {
  let h = 5381;
  for (const ch of text) h = (h * 33 + ch.charCodeAt(0)) >>> 0; // >>> 0 — оставляем 32 бита без знака
  return h;
}

export class BookingService {
  /**
   * @param {object} options
   * @param {() => Date} options.now  текущее время; в тестах подставляем фиксированное
   * @param {number} options.prebookedShare  доля времени, уже занятого "другими пациентами" (0..1)
   */
  constructor({ now = () => new Date(), prebookedShare = 0.35, doctors = DOCTORS, schedule = SCHEDULE } = {}) {
    this.now = now;
    this.prebookedShare = prebookedShare;
    this.doctors = doctors;
    this.schedule = schedule;
    this.appointments = []; // записи, сделанные через ассистента
    this.nextId = 1001;
  }

  getDoctor(doctorId) {
    return this.doctors.find((d) => d.id === doctorId) ?? null;
  }

  // Время занято "другими пациентами". Чтобы расписание выглядело живым и при этом
  // не менялось от запуска к запуску, занятость вычисляем по хешу врач+дата+время.
  isPrebooked(doctorId, dateKey, time) {
    return hash(`${doctorId}|${dateKey}|${time}`) % 100 < this.prebookedShare * 100;
  }

  // Время занято записью, сделанной через ассистента.
  isTaken(doctorId, dateKey, time, exceptId = null) {
    return this.appointments.some(
      (a) => a.status === "active" && a.id !== exceptId &&
        a.doctorId === doctorId && a.dateKey === dateKey && a.time === time,
    );
  }

  // Свободное время врача на дату. Пусто, если день выходной или уже прошёл.
  async getFreeSlots(doctorId, dateKey) {
    if (!this.getDoctor(doctorId)) throw new BookingError("UNKNOWN_DOCTOR", `Нет врача ${doctorId}`);
    const date = fromKey(dateKey);
    const now = this.now();
    if (!this.schedule.workDays.includes(date.getDay())) return [];
    if (date < startOfDay(now)) return [];

    const isToday = dateKey === toKey(now);
    return timeSlots(this.schedule.start, this.schedule.end, this.schedule.slotMinutes).filter(
      (time) =>
        !this.isPrebooked(doctorId, dateKey, time) &&
        !this.isTaken(doctorId, dateKey, time) &&
        !(isToday && time <= timeOfDay(now)), // сегодня — только время, которое ещё не наступило
    );
  }

  // Ближайшие дни, в которые у врача есть свободное время.
  async findNearestDates(doctorId, daysAhead, limit = 3) {
    const today = startOfDay(this.now());
    const result = [];
    for (let i = 0; i <= daysAhead && result.length < limit; i++) {
      const key = toKey(addDays(today, i));
      if ((await this.getFreeSlots(doctorId, key)).length > 0) result.push(key);
    }
    return result;
  }

  // Создаёт запись. Время проверяем ещё раз прямо перед созданием:
  // пока человек вводил имя и телефон, это время мог занять кто-то другой.
  async book({ doctorId, dateKey, time, name, phone }) {
    const free = await this.getFreeSlots(doctorId, dateKey);
    if (!free.includes(time)) throw new BookingError("SLOT_TAKEN", "Это время уже занято");
    const appointment = { id: `A-${this.nextId++}`, doctorId, dateKey, time, name, phone, status: "active" };
    this.appointments.push(appointment);
    return { ...appointment }; // отдаём копию, чтобы снаружи нельзя было изменить хранилище
  }

  // Активные будущие записи по номеру телефона, от ближайшей к дальней.
  async findByPhone(phone) {
    const todayKey = toKey(this.now());
    return this.appointments
      .filter((a) => a.status === "active" && a.phone === phone && a.dateKey >= todayKey)
      .sort((a, b) => (a.dateKey + a.time).localeCompare(b.dateKey + b.time))
      .map((a) => ({ ...a }));
  }

  async cancel(id) {
    const appointment = this.findActive(id);
    appointment.status = "cancelled";
    return { ...appointment };
  }

  async reschedule(id, dateKey, time) {
    const appointment = this.findActive(id);
    const free = await this.getFreeSlots(appointment.doctorId, dateKey);
    if (!free.includes(time)) throw new BookingError("SLOT_TAKEN", "Это время уже занято");
    appointment.dateKey = dateKey;
    appointment.time = time;
    return { ...appointment };
  }

  findActive(id) {
    const appointment = this.appointments.find((a) => a.id === id && a.status === "active");
    if (!appointment) throw new BookingError("NOT_FOUND", `Запись ${id} не найдена`);
    return appointment;
  }

  // Демо-данные: две записи на тестовый номер, чтобы сразу можно было
  // попробовать отмену и перенос, не создавая запись вручную.
  async seedDemo(phone = "+79001234567", name = "Тестовый Пациент") {
    for (const doctorId of ["therapist", "dentist"]) {
      const [dateKey] = await this.findNearestDates(doctorId, 14, 1);
      if (!dateKey) continue;
      const [time] = await this.getFreeSlots(doctorId, dateKey);
      await this.book({ doctorId, dateKey, time, name, phone });
    }
  }
}
