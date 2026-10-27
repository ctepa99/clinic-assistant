// Терминальная версия ассистента: npm start
// Логика диалога общая с веб-версией (src/assistant.js), здесь только ввод и вывод.

import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { createAssistant } from "./src/assistant.js";
import { BookingService } from "./src/booking-service.js";

const service = new BookingService();
await service.seedDemo(); // две демо-записи на номер +7 900 123-45-67

const assistant = createAssistant({
  service,
  onHandoff: (history) => console.log(`\n[Система] Диалог передан оператору, сообщений в истории: ${history.length}`),
});

const rl = readline.createInterface({ input, output });
const print = (messages) => messages.forEach((m) => console.log(`\nАссистент: ${m}`));
const prompt = () => output.write("\nВы: ");

console.log("Ассистент клиники. Для выхода напишите «выход» или нажмите Ctrl+C.");
console.log("Демо-номер с готовыми записями: +7 900 123-45-67");
print(assistant.start());
prompt();

// for await читает строки по одной и ждёт, пока обработается предыдущая.
// (rl.question не подходит: при вводе через конвейер "|" он теряет строки,
// пришедшие раньше, чем задан вопрос.)
for await (const line of rl) {
  if (!input.isTTY) output.write(line + "\n"); // при вводе из файла показываем, что "напечатано"
  if (line.trim().toLowerCase() === "выход") break;
  print(await assistant.handle(line));
  prompt();
}
rl.close();
