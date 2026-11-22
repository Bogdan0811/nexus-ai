#!/usr/bin/env node
// =====================================================================
// NEXUS AI · паритет маскирования ПДн: сервер (server/mask-pii.mjs, источник истины)
// против браузера (NX.maskPII, блок <nx-mask-pii> в assets/js/core.js).
// Запуск из корня проекта:  node scripts/mask-parity.mjs
// Без зависимостей (SDK не нужен). Код 0 — копии совпадают на всём корпусе, 1 — расхождение.
// Корпус: assets/data/attack-corpus.js (все разделы), assets/data/sms-corpus.js,
//         assets/data/call-scenarios.js — каждая строка с основами имён и без них.
// =====================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { maskPII as serverMask, nameStems as serverStems } from "../server/mask-pii.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

// 1. браузерная копия: вырезаем самодостаточный блок из core.js и выполняем его в песочнице
const core = read("assets/js/core.js");
const block = core.match(/\/\* <nx-mask-pii>[\s\S]*?\/\* <\/nx-mask-pii> \*\//);
if (!block) {
  console.error("FAIL: в assets/js/core.js не найден блок /* <nx-mask-pii> */ … /* </nx-mask-pii> */");
  process.exit(1);
}
const sandbox = { NX: {} };
vm.createContext(sandbox);
vm.runInContext(block[0], sandbox, { filename: "core.js#nx-mask-pii" });
const clientMask = sandbox.NX.maskPII;
if (typeof clientMask !== "function" || typeof clientMask.stems !== "function") {
  console.error("FAIL: блок <nx-mask-pii> не определил NX.maskPII и NX.maskPII.stems");
  process.exit(1);
}

// 2. корпус: браузерные data-файлы выполняются с поддельным window
function loadData(file) {
  const win = {};
  const ctx = { window: win, self: win, globalThis: win };
  vm.createContext(ctx);
  vm.runInContext(read(file), ctx, { filename: file });
  return win;
}
const strings = [];
const walk = (v) => {
  if (typeof v === "string") { if (v.trim().length >= 4) strings.push(v); return; }
  if (Array.isArray(v)) { v.forEach(walk); return; }
  if (v && typeof v === "object") Object.keys(v).forEach((k) => walk(v[k]));
};
const attack = loadData("assets/data/attack-corpus.js").NX_ATTACK;
walk(attack);
walk(loadData("assets/data/sms-corpus.js").NX_CORPUS);
walk(loadData("assets/data/call-scenarios.js"));
const texts = [...new Set(strings)];

// основы имён: из реплик корпуса атак + синтетические имена демо (как их собирает кабинет)
const names = [];
(attack.pii || []).forEach((p) => (p.names || []).forEach((n) => names.push(n)));
names.push("Гульнара Сериковна", "Гульнара С. (мама)", "Ерлан К.", "Динара Ж. (сестра)", "Сапарбек Т.", "Нурлан А.", "Азамат Р.", "Сауле Д.");

let fails = 0;
const report = (what, a, b, t) => {
  fails++;
  if (fails <= 10) console.error(`MISMATCH ${what}\n  text:   ${t}\n  server: ${a}\n  client: ${b}`);
};

const sStems = serverStems(names);
const cStems = Array.from(clientMask.stems(names));
if (JSON.stringify(sStems) !== JSON.stringify(cStems)) report("nameStems", JSON.stringify(sStems), JSON.stringify(cStems), names.join(", "));

let checks = 0, changed = 0;
for (const t of texts) {
  for (const opts of [undefined, { stems: sStems }]) {
    const a = serverMask(t, opts);
    const b = clientMask(t, opts ? { stems: cStems } : undefined);
    checks++;
    if (a !== t) changed++;
    if (a !== b) report(opts ? "maskPII+stems" : "maskPII", a, b, t);
  }
}

// 3. ожидаемые метки в репликах с ПДн (не паритет, а проверка, что маска что-то делает)
let expMiss = 0;
for (const p of attack.pii || []) {
  const out = serverMask(p.t, { stems: serverStems(p.names || []) });
  const miss = (p.expect || []).filter((tok) => out.indexOf(tok) < 0);
  if (miss.length) { expMiss++; console.error(`EXPECT ${p.id}: нет ${miss.join(", ")}\n  → ${out}`); }
}

console.log(`mask-parity: ${texts.length} строк корпуса, ${checks} сравнений, в ${changed} маска что-то заменила`);
console.log(`  основы имён: ${sStems.length} (${sStems.join(", ")})`);
console.log(`  расхождений сервер/браузер: ${fails}`);
console.log(`  реплик с ПДн без ожидаемой метки: ${expMiss} из ${(attack.pii || []).length}`);
if (fails) { console.error("FAIL: копии маскирования расходятся — перенесите правило из server/mask-pii.mjs в core.js"); process.exit(1); }
console.log("OK: server/mask-pii.mjs и NX.maskPII дают одинаковый результат");
