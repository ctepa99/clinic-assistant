// Работа с датами. Внутри программы дата хранится строкой-ключом "ГГГГ-ММ-ДД":
// такие строки удобно сравнивать (порядок строк совпадает с порядком дат)
// и использовать как ключи, а пользователю мы показываем "ДД.ММ".

export const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
export const WEEKDAYS_LONG = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

const pad = (n) => String(n).padStart(2, "0"); // 5 -> "05"

// Обнуляет время: остаётся только календарный день.
export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Прибавляет дни. Date сам переносит переполнение: 31 октября + 1 = 1 ноября.
export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Разница в днях между двумя датами (a - b).
export function diffDays(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86_400_000); // мс в сутках
}

// Date -> "2026-10-28"
export function toKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "2026-10-28" -> Date
export function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Date -> "28.10"
export function formatDate(date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

// "2026-10-28" -> "28.10 (ср)"
export function formatDateKey(key) {
  const date = fromKey(key);
  return `${formatDate(date)} (${WEEKDAYS_SHORT[date.getDay()]})`;
}

// Текущее время в виде "ЧЧ:ММ" — для сравнения со слотами расписания.
export function timeOfDay(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Все времена приёма за день: от start до end с шагом step минут.
// ("09:00", "11:00", 30) -> ["09:00", "09:30", "10:00", "10:30"]
export function timeSlots(start, end, step) {
  const toMinutes = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const slots = [];
  for (let t = toMinutes(start); t < toMinutes(end); t += step) {
    slots.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  }
  return slots;
}
