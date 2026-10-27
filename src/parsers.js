// Разбор ответов пользователя. Каждая функция получает текст и возвращает
// понятное программе значение — или null, если ответ распознать не удалось.
// Ассистент работает на правилах, без нейросети: так поведение предсказуемо
// и его легко проверить тестами.

import { addDays, startOfDay, diffDays } from "./dates.js";

// Приводит текст к виду для поиска ключевых слов:
// нижний регистр, "ё" -> "е", знаки препинания -> пробелы, лишние пробелы убраны.
export function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.,!?;:"«»()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Расстояние Левенштейна: сколько букв нужно заменить, вставить или удалить,
// чтобы из одного слова получить другое. "нивролог" -> "невролог" = 1.
// Нужно, чтобы ассистент понимал слова с опечатками.
export function levenshtein(a, b) {
  // prev[j] — расстояние между первыми i-1 буквами a и первыми j буквами b
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

// ---------- намерения и команды ----------

// Что хочет пользователь в главном меню. Порядок проверок важен:
// "отменить запись" содержит "запис", поэтому отмену и перенос ищем раньше записи.
const INTENTS = [
  ["reschedule", ["перенес", "перенос", "другое время", "другой день", "поменять время", "изменить время"]],
  ["cancel", ["отмен", "не приду", "не смогу прийти", "удали"]],
  ["book", ["запис", "прием", "к врачу", "попасть"]],
];

export function detectIntent(text) {
  const n = normalize(text);
  for (const [intent, stems] of INTENTS) {
    if (stems.some((s) => n.includes(s))) return intent;
  }
  return null;
}

// Просьба позвать человека.
const OPERATOR_WORDS = ["оператор", "администратор", "человек", "живой", "живым", "менеджер"];

export function isOperatorRequest(text) {
  const n = normalize(text);
  return OPERATOR_WORDS.some((w) => n.includes(w));
}

// Команды "начать заново". Сравниваем целиком, а не по вхождению,
// чтобы слово "меню" внутри длинной фразы не сбрасывало диалог.
const RESTART_COMMANDS = ["меню", "главное меню", "начать заново", "сначала", "в начало", "стоп", "/start"];

export function isRestart(text) {
  return RESTART_COMMANDS.includes(normalize(text));
}

// Да / нет. Сначала проверяем "нет": иначе "не верно" нашлось бы как "верно".
const NO_WORDS = ["нет", "неа", "не надо", "не нужно", "не верно", "неверно", "не подтверждаю", "no"];
const YES_WORDS = ["да", "ага", "угу", "верно", "все верно", "правильно", "подтверждаю", "конечно", "ок", "окей", "хорошо", "давай", "yes"];

export function parseYesNo(text) {
  const n = normalize(text);
  // Слово совпадает целиком или стоит в начале фразы: "да, все верно".
  const starts = (w) => n === w || n.startsWith(w + " ");
  if (NO_WORDS.some(starts)) return false;
  if (YES_WORDS.some(starts)) return true;
  return null;
}

// ---------- врач ----------

// Ищет врача по ключевым словам или по номеру из списка ("2").
export function matchDoctor(text, doctors) {
  const n = normalize(text);
  if (/^\d+$/.test(n)) {
    return doctors[Number(n) - 1] ?? null; // номер вне списка -> null
  }
  const words = n.split(" ");
  for (const doctor of doctors) {
    for (const kw of doctor.keywords) {
      for (const word of words) {
        // "неврологу" начинается с "невролог" — подходит.
        if (word.startsWith(kw)) return doctor;
        if (isTypoOf(word, kw)) return doctor;
      }
    }
  }
  return null;
}

// Слово начинается с ключа, но с опечатками. Опечатка может добавить или убрать
// букву ("нивроллогу"), поэтому сравниваем с ключом начала слова длиной ±1 букву.
// Допустимо ошибок: 1 для ключей из 6–7 букв, 2 для более длинных.
// Короткие ключи ("лор", "зуб") не проверяем: они совпадали бы с чем попало.
function isTypoOf(word, kw) {
  if (kw.length < 6) return false;
  const maxErrors = kw.length >= 8 ? 2 : 1;
  for (let len = kw.length - 1; len <= kw.length + 1; len++) {
    if (len <= word.length && levenshtein(word.slice(0, len), kw) <= maxErrors) return true;
  }
  return false;
}

// Приветствие: "привет", "здравствуйте", "добрый день".
export function isGreeting(text) {
  return /^(привет|здравств|здраств|добр(ый|ое|ого)|доброго|хай|hello|hi)/.test(normalize(text));
}

// ---------- дата ----------

const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
// Начала названий дней недели; индекс совпадает с Date.getDay() (0 — воскресенье).
const WEEKDAY_STEMS = ["воскресен", "понедельник", "вторник", "сред", "четверг", "пятниц", "суббот"];

// Собирает дату и проверяет, что она существует (31.02 не пройдёт:
// Date превратил бы её в 3 марта, поэтому сверяем день и месяц обратно).
function makeDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

// Год не указан: берём текущий. Если дата прошла больше полугода назад,
// человек, скорее всего, имеет в виду следующий год ("10.01" в декабре).
// Недавно прошедшую дату оставляем как есть — ассистент скажет, что она прошла.
function withGuessedYear(today, month, day) {
  const date = makeDate(today.getFullYear(), month, day);
  if (!date) return null;
  if (diffDays(today, date) > 180) return makeDate(today.getFullYear() + 1, month, day);
  return date;
}

// Понимает: "сегодня", "завтра", "послезавтра", "05.11", "5/11/2026",
// "5 ноября", "в пятницу". Возвращает Date (начало дня) или null.
export function parseDate(text, now) {
  const s = String(text).toLowerCase().replace(/ё/g, "е");
  const today = startOfDay(now);

  // "послезавтра" проверяем раньше "завтра": оно содержит это слово внутри.
  if (s.includes("послезавтра")) return addDays(today, 2);
  if (s.includes("завтра")) return addDays(today, 1);
  if (s.includes("сегодня")) return today;

  // Число и месяц цифрами: 05.11, 5-11, 05/11/2026, 05.11.26
  let m = s.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}|\d{2}))?/);
  if (m) {
    const [day, month] = [Number(m[1]), Number(m[2])];
    if (m[3]) {
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return makeDate(year, month, day);
    }
    return withGuessedYear(today, month, day);
  }

  // Число и месяц словом: "5 ноября", "12 мая"
  m = s.match(/(\d{1,2})\s*([а-я]+)/);
  if (m) {
    const monthIndex = MONTHS.findIndex((stem) => m[2].startsWith(stem));
    if (monthIndex !== -1) return withGuessedYear(today, monthIndex + 1, Number(m[1]));
  }

  // День недели: ближайший такой день после сегодняшнего.
  const weekday = WEEKDAY_STEMS.findIndex((stem) => s.includes(stem));
  if (weekday !== -1) {
    const ahead = (weekday - today.getDay() + 7) % 7 || 7; // 0 -> через неделю
    return addDays(today, ahead);
  }

  return null;
}

// ---------- время ----------

// Понимает: "10", "10:30", "10.30", "в 14", "в 3 дня". Возвращает "ЧЧ:ММ" или null.
export function parseTime(text) {
  const s = String(text).toLowerCase();
  const m = s.match(/(\d{1,2})(?:\s*[:.]\s*(\d{2}))?/);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  // "в 3 дня", "в 5 вечера" — время после полудня.
  if (/(дня|вечера)/.test(s) && hours < 12) hours += 12;
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// ---------- телефон и имя ----------

// Оставляет только цифры и приводит российский номер к виду +7XXXXXXXXXX.
// "8 (912) 345-67-89" -> "+79123456789"
export function parsePhone(text) {
  const digits = String(text).replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) return "+7" + digits.slice(1);
  if (digits.length === 10 && digits[0] === "9") return "+7" + digits;
  return null;
}

// "+79123456789" -> "+7 912 345-67-89"
export function formatPhone(phone) {
  const d = phone.slice(2);
  return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

// Имя: от одного до трёх слов из букв (допускается дефис: "Анна-Мария").
// Длинная фраза — скорее вопрос, чем имя, поэтому её не принимаем.
export function parseName(text) {
  const s = String(text)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(меня зовут|я)\s+/i, ""); // "меня зовут Анна" -> "Анна"
  const letters = "A-Za-zА-Яа-яЁё";
  const pattern = new RegExp(`^[${letters}]+(?:-[${letters}]+)?(?: [${letters}]+(?:-[${letters}]+)?){0,2}$`);
  if (s.length < 2 || !pattern.test(s)) return null;
  // Каждое слово (и часть через дефис) — с заглавной буквы.
  return s.toLowerCase().replace(/(^|[ -])([a-zа-яё])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

// ---------- частые вопросы ----------

export function findFaq(text, faq) {
  const n = normalize(text);
  return faq.find((item) => item.keywords.some((k) => n.includes(k))) ?? null;
}
