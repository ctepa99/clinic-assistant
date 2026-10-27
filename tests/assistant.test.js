// Тесты сценариев диалога: проходим разговор целиком, как живой пользователь.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssistant } from "../src/assistant.js";
import { BookingService } from "../src/booking-service.js";

// Вторник, 27.10.2026, 08:00. Все слоты свободны, чтобы тесты не зависели от "чужих" записей.
const now = () => new Date(2026, 9, 27, 8, 0);

function setup() {
  const service = new BookingService({ now, prebookedShare: 0 });
  const handoffs = [];
  const assistant = createAssistant({ service, now, onHandoff: (h) => handoffs.push(h) });
  assistant.start();
  // say("текст") -> все реплики ассистента одной строкой, удобно искать подстроки.
  const say = async (text) => (await assistant.handle(text)).join("\n");
  return { service, assistant, say, handoffs };
}

test("полная запись к врачу", async () => {
  const { service, assistant, say } = setup();

  assert.match(await say("Хочу записаться"), /К какому специалисту/);
  assert.match(await say("к неврологу"), /Ближайшие свободные дни: 27\.10 \(вт\)/);
  assert.match(await say("завтра"), /Свободное время на 28\.10 \(ср\): 09:00/);
  assert.match(await say("10:00"), /Как вас зовут/);
  assert.match(await say("иван петров"), /номер телефона/);

  const summary = await say("8 912 345 67 89");
  assert.match(summary, /Пациент: Иван Петров/);
  assert.match(summary, /Телефон: \+7 912 345-67-89/);

  assert.match(await say("да"), /Готово! Вы записаны: 28\.10 \(ср\) в 10:00 — невролог.*A-1001/s);
  assert.equal(assistant.state, "menu");
  assert.equal((await service.findByPhone("+79123456789")).length, 1);
});

test("на приветствие ассистент здоровается и не считает это ошибкой", async () => {
  const { assistant, say } = setup();
  assert.match(await say("привет"), /Здравствуйте!/);
  assert.match(await say("добрый день"), /Здравствуйте!/);
  assert.equal(assistant.state, "menu"); // к оператору не ушли
});

test("врач назван сразу — вопрос о враче пропускается", async () => {
  const { assistant, say } = setup();
  await say("запишите к терапевту");
  assert.equal(assistant.state, "ask_date");
});

test("неподходящие даты объясняются, вопрос повторяется", async () => {
  const { assistant, say } = setup();
  await say("к стоматологу");
  assert.match(await say("31.10"), /суббота, клиника не работает/);
  assert.match(await say("01.10"), /уже прошло/);
  assert.match(await say("20.11"), /до 10\.11/);
  assert.equal(assistant.state, "ask_date");
});

test("отмена записи по телефону", async () => {
  const { service, say } = setup();
  const a = await service.book({ doctorId: "dentist", dateKey: "2026-10-29", time: "12:00", name: "Анна", phone: "+79001112233" });

  await say("отменить запись");
  assert.match(await say("+7 900 111 22 33"), /Отменить запись: 29\.10 \(чт\) в 12:00 — стоматолог/);
  assert.match(await say("да"), /Запись отменена/);
  assert.equal((await service.findByPhone(a.phone)).length, 0);
});

test("перенос записи, когда записей несколько", async () => {
  const { service, say } = setup();
  const phone = "+79001112233";
  await service.book({ doctorId: "dentist", dateKey: "2026-10-29", time: "12:00", name: "Анна", phone });
  await service.book({ doctorId: "therapist", dateKey: "2026-10-30", time: "09:00", name: "Анна", phone });

  await say("перенести запись");
  assert.match(await say(phone), /Нашёл несколько записей/);
  assert.match(await say("2"), /Нашёл запись: 30\.10 \(пт\) в 09:00 — терапевт/);
  await say("02.11");
  assert.match(await say("11:30"), /Перенести запись с 30\.10 \(пт\) 09:00 на 02\.11 \(пн\) 11:30/);
  assert.match(await say("да"), /запись перенесена/);

  const [, moved] = await service.findByPhone(phone);
  assert.equal(moved.dateKey, "2026-11-02");
  assert.equal(moved.time, "11:30");
});

test("если время заняли во время оформления, ассистент просит выбрать другое", async () => {
  const { service, assistant, say } = setup();
  await say("к терапевту");
  await say("завтра");
  await say("10:00");
  await say("Иван");
  await say("89123456789");
  // Пока пользователь думал, другой пациент занял 10:00.
  await service.book({ doctorId: "therapist", dateKey: "2026-10-28", time: "10:00", name: "Другой", phone: "+79990000000" });
  assert.match(await say("да"), /это время заняли/);
  assert.equal(assistant.state, "ask_time");
});

test("вопрос посреди сценария: ответ и тот же шаг", async () => {
  const { assistant, say } = setup();
  await say("к терапевту");
  const reply = await say("а какой у вас адрес?");
  assert.match(reply, /ул\. Садовая/);
  assert.match(reply, /На какую дату/);
  assert.equal(assistant.state, "ask_date");
});

test("цены в меню — справка, а не запись", async () => {
  const { assistant, say } = setup();
  assert.match(await say("сколько стоит приём у кардиолога?"), /Кардиолог — 2\s700 ₽/);
  assert.equal(assistant.state, "menu");
});

test("два непонятных ответа подряд — передача оператору с историей", async () => {
  const { assistant, say, handoffs } = setup();
  await say("к терапевту");
  assert.match(await say("абракадабра"), /не понял/);
  assert.match(await say("ываыва"), /Передаю разговор администратору/);
  assert.equal(assistant.state, "handoff");
  assert.equal(handoffs.length, 1);
  assert.ok(handoffs[0].some((m) => m.text === "абракадабра")); // оператор видит переписку
  assert.match(await say("алло"), /скоро ответит/);
});

test("оператор по просьбе и возврат в меню", async () => {
  const { assistant, say } = setup();
  assert.match(await say("позовите администратора"), /Передаю разговор/);
  assert.match(await say("меню"), /начнём сначала/);
  assert.equal(assistant.state, "menu");
});

test("на номер без записей ассистент так и отвечает", async () => {
  const { assistant, say } = setup();
  await say("отменить запись");
  assert.match(await say("89995554433"), /активных записей не нашёл/);
  assert.equal(assistant.state, "menu");
});
