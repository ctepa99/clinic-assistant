// Веб-версия: связывает страницу index.html с ассистентом.
// Вся логика диалога — в src/assistant.js, здесь только отображение.

import { createAssistant } from "../src/assistant.js";
import { BookingService } from "../src/booking-service.js";

const messagesEl = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const statusEl = document.getElementById("status");

const service = new BookingService();
await service.seedDemo(); // демо-записи на номер +7 900 123-45-67

const assistant = createAssistant({
  service,
  // В реальной системе здесь был бы запрос к CRM или чату операторов.
  onHandoff: (history) => {
    statusEl.textContent = "Ожидание администратора…";
    console.info("Передача оператору. История диалога:", history);
  },
});

// Добавляет одно сообщение в чат. textContent, а не innerHTML:
// так текст пользователя не может внедрить в страницу HTML или скрипт.
function addMessage(text, from) {
  const el = document.createElement("div");
  el.className = `msg msg--${from}`;
  el.textContent = text;
  messagesEl.append(el);
  messagesEl.scrollTop = messagesEl.scrollHeight; // прокрутка к последнему сообщению
}

// Показывает реплики ассистента по очереди с небольшой паузой, как в живом чате.
async function showBotMessages(messages) {
  for (const text of messages) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    addMessage(text, "bot");
  }
}

let busy = false; // пока ассистент отвечает, новые сообщения не принимаем

async function send(text) {
  if (busy || !text.trim()) return;
  busy = true;
  addMessage(text, "user");
  input.value = "";
  try {
    await showBotMessages(await assistant.handle(text));
  } catch (error) {
    console.error(error);
    addMessage("Произошла ошибка. Попробуйте ещё раз или позвоните нам.", "bot");
  } finally {
    busy = false;
    input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault(); // не перезагружать страницу при отправке формы
  send(input.value);
});

// Быстрые кнопки отправляют текст из атрибута data-text.
document.getElementById("quick").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-text]");
  if (button) send(button.dataset.text);
});

document.getElementById("restart").addEventListener("click", () => {
  messagesEl.replaceChildren();
  statusEl.textContent = "Виртуальный ассистент · онлайн";
  showBotMessages(assistant.start());
});

showBotMessages(assistant.start());
input.focus();
