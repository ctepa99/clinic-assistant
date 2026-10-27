// Тесты разбора ответов. Запуск всех тестов: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOCTORS } from "../src/clinic-data.js";
import { toKey } from "../src/dates.js";
import {
  detectIntent, isGreeting, isOperatorRequest, isRestart, levenshtein, matchDoctor,
  parseDate, parseName, parsePhone, parseTime, parseYesNo,
} from "../src/parsers.js";

// "Сегодня" в тестах всегда одно и то же: вторник, 27 октября 2026, 08:00.
// Иначе результат зависел бы от дня запуска.
const NOW = new Date(2026, 9, 27, 8, 0);
const date = (text) => {
  const d = parseDate(text, NOW);
  return d && toKey(d);
};

test("дата: слова «сегодня», «завтра», «послезавтра»", () => {
  assert.equal(date("сегодня"), "2026-10-27");
  assert.equal(date("завтра"), "2026-10-28");
  assert.equal(date("послезавтра"), "2026-10-29");
});

test("дата: цифрами и словом", () => {
  assert.equal(date("05.11"), "2026-11-05");
  assert.equal(date("5/11/2026"), "2026-11-05");
  assert.equal(date("05.11.27"), "2027-11-05");
  assert.equal(date("5 ноября"), "2026-11-05");
  assert.equal(date("на 3 марта"), "2027-03-03"); // март прошёл больше полугода назад -> следующий год
});

test("дата: день недели — ближайший после сегодня", () => {
  assert.equal(date("в пятницу"), "2026-10-30");
  assert.equal(date("во вторник"), "2026-11-03"); // сегодня вторник -> следующий
});

test("дата: недавно прошедшая остаётся в этом году, несуществующая не распознаётся", () => {
  assert.equal(date("01.10"), "2026-10-01");
  assert.equal(date("31.02"), null);
  assert.equal(date("когда-нибудь"), null);
});

test("время", () => {
  assert.equal(parseTime("10"), "10:00");
  assert.equal(parseTime("в 10:30"), "10:30");
  assert.equal(parseTime("14.30"), "14:30");
  assert.equal(parseTime("в 3 дня"), "15:00");
  assert.equal(parseTime("25:00"), null);
  assert.equal(parseTime("утром"), null);
});

test("телефон приводится к виду +7XXXXXXXXXX", () => {
  assert.equal(parsePhone("8 (912) 345-67-89"), "+79123456789");
  assert.equal(parsePhone("+7 912 345 67 89"), "+79123456789");
  assert.equal(parsePhone("9123456789"), "+79123456789");
  assert.equal(parsePhone("12345"), null);
});

test("имя", () => {
  assert.equal(parseName("иван петров"), "Иван Петров");
  assert.equal(parseName("меня зовут анна-мария"), "Анна-Мария");
  assert.equal(parseName("а где вы находитесь сейчас"), null); // слишком длинно для имени
  assert.equal(parseName("123"), null);
});

test("врач: по названию, с опечаткой, по номеру", () => {
  assert.equal(matchDoctor("к неврологу", DOCTORS).id, "neurologist");
  assert.equal(matchDoctor("нивролог", DOCTORS).id, "neurologist");
  assert.equal(matchDoctor("хочу к нивроллогу", DOCTORS).id, "neurologist"); // две опечатки
  assert.equal(matchDoctor("тирапефту", DOCTORS).id, "therapist");
  assert.equal(matchDoctor("болит зуб", DOCTORS).id, "dentist");
  assert.equal(matchDoctor("2", DOCTORS).id, "neurologist");
  assert.equal(matchDoctor("хирург", DOCTORS), null);
  assert.equal(matchDoctor("99", DOCTORS), null);
});

test("да / нет", () => {
  assert.equal(parseYesNo("Да, все верно"), true);
  assert.equal(parseYesNo("ок"), true);
  assert.equal(parseYesNo("нет"), false);
  assert.equal(parseYesNo("не верно"), false); // не путать с "верно"
  assert.equal(parseYesNo("не знаю"), null);
});

test("намерения и команды", () => {
  assert.equal(detectIntent("Хочу записаться"), "book");
  assert.equal(detectIntent("отменить запись"), "cancel"); // не "book", хотя есть "запис"
  assert.equal(detectIntent("можно перенести приём?"), "reschedule");
  assert.equal(detectIntent("привет"), null);
  assert.equal(isOperatorRequest("позовите человека"), true);
  assert.equal(isRestart("Меню"), true);
  assert.equal(isRestart("покажите меню цен"), false);
  assert.equal(isGreeting("Добрый день!"), true);
  assert.equal(isGreeting("привет"), true);
  assert.equal(isGreeting("хочу записаться"), false);
});

test("расстояние Левенштейна", () => {
  assert.equal(levenshtein("невролог", "невролог"), 0);
  assert.equal(levenshtein("нивролог", "невролог"), 1);
  assert.equal(levenshtein("кот", "скот"), 1);
});
