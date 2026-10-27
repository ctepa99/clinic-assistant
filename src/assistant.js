// Логика диалога ассистента.
//
// Диалог устроен как конечный автомат: в каждый момент ассистент находится
// в одном состоянии (шаге) — "спрашиваю врача", "спрашиваю дату" и т. д.
// У каждого шага есть:
//   ask()        — вопрос, который ассистент задаёт на этом шаге;
//   hint()       — подсказка, если ответ не распознан (необязательно);
//   handle(text) — разбор ответа. Возвращает { say: [...], go: "следующий шаг" }
//                  или null, если ответ не понят.
//
// Модуль не знает, где он работает: в браузере или в терминале. Он принимает текст
// и возвращает массив реплик, а показывают их web/app.js и cli.js.

import { BOOKING_HORIZON_DAYS, CLINIC, DOCTORS, FAQ } from "./clinic-data.js";
import { addDays, diffDays, formatDate, formatDateKey, startOfDay, toKey, WEEKDAYS_LONG } from "./dates.js";
import {
  detectIntent, findFaq, formatPhone, isGreeting, isOperatorRequest, isRestart,
  matchDoctor, parseDate, parseName, parsePhone, parseTime, parseYesNo,
} from "./parsers.js";

// После стольких нераспознанных ответов подряд разговор передаётся человеку.
const MAX_FAILURES = 2;

const HANDOFF_TEXT =
  "Передаю разговор администратору — он ответит в этом чате в рабочее время. " +
  "Чтобы вернуться к ассистенту, напишите «меню».";
const HANDOFF_WAIT =
  "Администратор уже получил ваш запрос и скоро ответит. Чтобы вернуться к ассистенту, напишите «меню».";

// "Смирнова Елена Викторовна" -> "Смирнова Е. В."
const shortName = (fullName) => {
  const [last, ...rest] = fullName.split(" ");
  return [last, ...rest.map((p) => p[0] + ".")].join(" ");
};

/**
 * Создаёт ассистента.
 * @param {object} options
 * @param {import("./booking-service.js").BookingService} options.service  система записи
 * @param {() => Date} [options.now]  текущее время (в тестах — фиксированное)
 * @param {(history: {from: string, text: string}[]) => void} [options.onHandoff]
 *        вызывается при передаче оператору; получает историю переписки
 */
export function createAssistant({ service, now = () => new Date(), onHandoff = () => {} }) {
  let state = "menu"; // текущий шаг
  let draft = {};     // данные текущего сценария: врач, дата, время, имя...
  let failures = 0;   // сколько раз подряд ответ не распознан
  let history = [];   // переписка — передаётся оператору

  const today = () => startOfDay(now());

  // ---------- вспомогательные функции ----------

  const doctorLine = (d) => `${capitalize(d.specialty)} — ${shortName(d.name)}`;

  const describeAppointment = (a) => {
    const doctor = service.getDoctor(a.doctorId);
    return `${formatDateKey(a.dateKey)} в ${a.time} — ${doctor.specialty}, ${shortName(doctor.name)}`;
  };

  // Готовит выбор даты для врача: ищет ближайшие свободные дни.
  // Если свободного времени нет совсем — сообщаем и возвращаемся в меню.
  async function goToDateStep(doctor, say = []) {
    draft.doctor = doctor;
    draft.suggestedDates = await service.findNearestDates(doctor.id, BOOKING_HORIZON_DAYS, 3);
    if (draft.suggestedDates.length === 0) {
      draft = {};
      return {
        say: [...say, `К сожалению, у врача (${doctor.specialty}) нет свободного времени в ближайшие ${BOOKING_HORIZON_DAYS} дней. ` +
          `Позвоните нам: ${CLINIC.phone}.`],
        go: "menu",
      };
    }
    return { say, go: "ask_date" };
  }

  // Выбрана запись для отмены или переноса — переходим к нужному сценарию.
  async function onAppointmentChosen(appointment) {
    draft.appointment = appointment;
    if (draft.mode === "cancel") return { say: [], go: "confirm_cancel" };
    const doctor = service.getDoctor(appointment.doctorId);
    // Без точки в конце: описание заканчивается инициалами ("Смирнова Е. В.").
    return goToDateStep(doctor, [`Нашёл запись: ${describeAppointment(appointment)}`]);
  }

  // ---------- шаги диалога ----------

  const STEPS = {
    menu: {
      ask: () => "Чем могу помочь?",
      hint: () => "Я могу записать к врачу, отменить или перенести запись, рассказать адрес, часы работы и цены.",
      async handle(text) {
        const intent = detectIntent(text);
        if (intent === "reschedule" || intent === "cancel") {
          draft = { mode: intent };
          return { say: [], go: "ask_phone_lookup" };
        }
        // Вопрос проверяем раньше записи: "сколько стоит приём у кардиолога"
        // содержит и "приём", и врача, но человек спрашивает цену.
        const faq = findFaq(text, FAQ);
        if (faq) return { say: [faq.answer], go: "menu", after: "Чем ещё могу помочь?" };
        // "Хочу к неврологу" — врач назван сразу, вопрос о враче пропускаем.
        const doctor = matchDoctor(text, DOCTORS);
        if (doctor && !/^\d+$/.test(text.trim())) {
          draft = { mode: "book" };
          return goToDateStep(doctor);
        }
        if (intent === "book") {
          draft = { mode: "book" };
          return { say: [], go: "ask_doctor" };
        }
        // На "привет" здороваемся в ответ и подсказываем, что умеем.
        if (isGreeting(text)) return { say: ["Здравствуйте! " + STEPS.menu.hint()], go: "menu" };
        return null;
      },
    },

    ask_doctor: {
      ask: () =>
        "К какому специалисту записать? Напишите название или номер:\n" +
        DOCTORS.map((d, i) => `${i + 1}. ${doctorLine(d)}`).join("\n"),
      hint: () => "Напишите специальность врача (например, «терапевт») или номер из списка.",
      async handle(text) {
        const doctor = matchDoctor(text, DOCTORS);
        return doctor ? goToDateStep(doctor) : null;
      },
    },

    ask_date: {
      ask: () =>
        (draft.mode === "reschedule" ? "На какую дату перенести запись? " : `На какую дату записать к ${draft.doctor.dative}? `) +
        `Ближайшие свободные дни: ${draft.suggestedDates.map(formatDateKey).join(", ")}.`,
      hint: () => "Напишите дату в формате ДД.ММ (например, 05.11) или словами: «завтра», «в пятницу», «5 ноября».",
      async handle(text) {
        const date = parseDate(text, now());
        if (!date) return null;
        const lastDay = addDays(today(), BOOKING_HORIZON_DAYS);
        // Дата распознана, но не подходит: объясняем почему и спрашиваем снова.
        // Это не считается "не понял", поэтому к оператору такие ответы не ведут.
        if (date < today()) return { say: [`${formatDate(date)} уже прошло.`], go: "ask_date" };
        if (diffDays(date, today()) > BOOKING_HORIZON_DAYS) {
          return { say: [`Запись открыта на ${BOOKING_HORIZON_DAYS} дней вперёд, до ${formatDate(lastDay)}.`], go: "ask_date" };
        }
        const slots = await service.getFreeSlots(draft.doctor.id, toKey(date));
        if (slots.length === 0) {
          const reason = [0, 6].includes(date.getDay())
            ? `${formatDate(date)} — ${WEEKDAYS_LONG[date.getDay()]}, клиника не работает.`
            : `На ${formatDate(date)} свободного времени нет.`;
          return { say: [reason], go: "ask_date" };
        }
        draft.dateKey = toKey(date);
        draft.slots = slots;
        return { say: [], go: "ask_time" };
      },
    },

    ask_time: {
      ask: () => `Свободное время на ${formatDateKey(draft.dateKey)}: ${draft.slots.join(", ")}. Какое время удобно?`,
      hint: () => `Напишите время из списка, например ${draft.slots[0]}.`,
      async handle(text) {
        const time = parseTime(text);
        if (!time) return null;
        if (!draft.slots.includes(time)) {
          return { say: [`Время ${time} недоступно.`], go: "ask_time" };
        }
        draft.time = time;
        return { say: [], go: draft.mode === "reschedule" ? "confirm_reschedule" : "ask_name" };
      },
    },

    ask_name: {
      ask: () => "Как вас зовут? Напишите имя и фамилию.",
      hint: () => "Напишите только имя и фамилию, например: Иван Петров.",
      async handle(text) {
        // "Где вы находитесь" по форме похоже на имя из трёх слов, но это вопрос:
        // возвращаем null, и ответ на него даст общий обработчик FAQ.
        if (findFaq(text, FAQ)) return null;
        const name = parseName(text);
        if (!name) return null;
        draft.name = name;
        return { say: [], go: "ask_phone" };
      },
    },

    ask_phone: {
      ask: () => "Укажите номер телефона для связи.",
      hint: () => "Напишите российский номер, например +7 912 345-67-89 или 8 912 345 67 89.",
      async handle(text) {
        const phone = parsePhone(text);
        if (!phone) return null;
        draft.phone = phone;
        return { say: [], go: "confirm_booking" };
      },
    },

    confirm_booking: {
      ask: () =>
        "Проверьте, пожалуйста:\n" +
        `Врач: ${draft.doctor.specialty}, ${draft.doctor.name}\n` +
        `Дата и время: ${formatDateKey(draft.dateKey)} в ${draft.time}\n` +
        `Пациент: ${draft.name}\n` +
        `Телефон: ${formatPhone(draft.phone)}\n` +
        "Всё верно? (да / нет)",
      hint: () => "Ответьте «да», чтобы подтвердить запись, или «нет», чтобы отменить.",
      async handle(text) {
        const answer = parseYesNo(text);
        if (answer === null) return null;
        if (!answer) {
          draft = {};
          return { say: ["Хорошо, запись не создана."], go: "menu" };
        }
        try {
          const a = await service.book({
            doctorId: draft.doctor.id, dateKey: draft.dateKey, time: draft.time,
            name: draft.name, phone: draft.phone,
          });
          draft = {};
          return {
            say: [`Готово! Вы записаны: ${describeAppointment(a)}\n` +
              `Номер записи: ${a.id}\n` +
              `Адрес: ${CLINIC.address}\n` +
              "Пожалуйста, приходите за 10 минут до приёма, возьмите паспорт и полис."],
            go: "menu",
          };
        } catch (error) {
          return handleSlotTaken(error);
        }
      },
    },

    ask_phone_lookup: {
      ask: () => "Назовите номер телефона, на который оформлена запись.",
      hint: () => "Напишите номер, например +7 912 345-67-89.",
      async handle(text) {
        const phone = parsePhone(text);
        if (!phone) return null;
        const found = await service.findByPhone(phone);
        if (found.length === 0) {
          draft = {};
          return { say: [`На номер ${formatPhone(phone)} активных записей не нашёл.`], go: "menu" };
        }
        if (found.length === 1) return onAppointmentChosen(found[0]);
        draft.found = found;
        return { say: [], go: "choose_appointment" };
      },
    },

    choose_appointment: {
      ask: () =>
        "Нашёл несколько записей:\n" +
        draft.found.map((a, i) => `${i + 1}. ${describeAppointment(a)}`).join("\n") +
        "\nКакую выбрать? Напишите номер.",
      hint: () => `Напишите номер записи от 1 до ${draft.found.length}.`,
      async handle(text) {
        const index = Number(text.trim()) - 1;
        const appointment = draft.found[index];
        return appointment ? onAppointmentChosen(appointment) : null;
      },
    },

    confirm_cancel: {
      ask: () => `Отменить запись: ${describeAppointment(draft.appointment)}? (да / нет)`,
      hint: () => "Ответьте «да», чтобы отменить запись, или «нет», чтобы её сохранить.",
      async handle(text) {
        const answer = parseYesNo(text);
        if (answer === null) return null;
        const say = [];
        if (answer) {
          await service.cancel(draft.appointment.id);
          say.push("Запись отменена.");
        } else {
          say.push("Хорошо, запись сохранена.");
        }
        draft = {};
        return { say, go: "menu" };
      },
    },

    confirm_reschedule: {
      ask: () =>
        `Перенести запись с ${formatDateKey(draft.appointment.dateKey)} ${draft.appointment.time} ` +
        `на ${formatDateKey(draft.dateKey)} ${draft.time}? (да / нет)`,
      hint: () => "Ответьте «да», чтобы перенести запись, или «нет», чтобы оставить как было.",
      async handle(text) {
        const answer = parseYesNo(text);
        if (answer === null) return null;
        if (!answer) {
          draft = {};
          return { say: ["Хорошо, запись осталась без изменений."], go: "menu" };
        }
        try {
          const a = await service.reschedule(draft.appointment.id, draft.dateKey, draft.time);
          draft = {};
          return { say: [`Готово, запись перенесена: ${describeAppointment(a)}`], go: "menu" };
        } catch (error) {
          return handleSlotTaken(error);
        }
      },
    },
  };

  // Пока человек подтверждал запись, время успели занять: обновляем список и просим выбрать снова.
  async function handleSlotTaken(error) {
    if (error.code !== "SLOT_TAKEN") throw error; // другие ошибки не прячем
    draft.slots = await service.getFreeSlots(draft.doctor.id, draft.dateKey);
    if (draft.slots.length === 0) {
      return { say: ["Пока мы оформляли запись, всё время на этот день заняли."], go: "ask_date" };
    }
    return { say: ["Пока мы оформляли запись, это время заняли."], go: "ask_time" };
  }

  // Переход к оператору.
  function handoff(prefix = "") {
    state = "handoff";
    failures = 0;
    onHandoff([...history]);
    return [prefix + HANDOFF_TEXT];
  }

  // Применяет результат шага: переходит в новое состояние и добавляет его вопрос.
  // result.after заменяет стандартный вопрос шага (после справки в меню
  // уместнее "Чем ещё могу помочь?", чем повторное "Чем могу помочь?").
  function apply(result) {
    state = result.go;
    return [...result.say, result.after ?? STEPS[state].ask()];
  }

  function reset() {
    state = "menu";
    draft = {};
    failures = 0;
  }

  function remember(from, messages) {
    for (const text of messages) history.push({ from, text });
    return messages;
  }

  // ---------- публичный интерфейс ----------

  return {
    // Текущее состояние — нужно тестам и для отладки.
    get state() {
      return state;
    },

    // Начало разговора: приветствие и первый вопрос.
    start() {
      reset();
      history = [];
      return remember("bot", [
        `Здравствуйте! Я виртуальный ассистент ${CLINIC.nameGenitive}.\n` +
          "Могу:\n• записать вас к врачу\n• отменить или перенести запись\n• рассказать адрес, часы работы и цены\n" +
          "Если нужен администратор, напишите «оператор».",
        STEPS.menu.ask(),
      ]);
    },

    // Обработка одного сообщения пользователя. Возвращает массив реплик ассистента.
    async handle(text) {
      const input = String(text ?? "").trim();
      remember("user", [input]);
      return remember("bot", await respond(input));
    },
  };

  async function respond(input) {
    if (!input) return [STEPS[state]?.ask() ?? HANDOFF_WAIT];

    // Глобальные команды работают на любом шаге.
    if (isRestart(input)) {
      reset();
      return ["Хорошо, начнём сначала.", STEPS.menu.ask()];
    }
    if (state === "handoff") return [HANDOFF_WAIT];
    if (isOperatorRequest(input)) return handoff();

    const step = STEPS[state];
    const result = await step.handle(input);
    if (result) {
      failures = 0;
      return apply(result);
    }

    // Ответ не подошёл к шагу, но, возможно, это вопрос из FAQ:
    // отвечаем и повторяем вопрос шага, не теряя введённые данные.
    const faq = findFaq(input, FAQ);
    if (faq) return [faq.answer, step.ask()];

    failures += 1;
    if (failures >= MAX_FAILURES) return handoff("Похоже, я не могу понять ответ. ");
    return ["Извините, я не понял. " + (step.hint ? step.hint() : step.ask())];
  }
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
