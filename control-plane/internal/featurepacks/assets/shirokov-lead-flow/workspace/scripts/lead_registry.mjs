#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULTS = {
  lead_id: "",
  created_at: "",
  updated_at: "",
  status: "",
  stage: "",
  priority: "",
  source: "",
  channel: "",
  thread: "",
  name: "",
  contact: "",
  telegram_username: "",
  telegram_user_id: "",
  region: "",
  project_type: "",
  units: "",
  model_or_use_case: "",
  timeline: "",
  budget: "",
  key_need: "",
  risks: "",
  requested_next_step: "",
  summary: "",
  manager_routed_at: "",
  manager_route_targets: [],
  manager_delivery_log: [],
};

function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function workspaceRoot() {
  return path.resolve(__dirname, "..");
}

function leadsDir() {
  return path.join(workspaceRoot(), "leads");
}

function registryPath() {
  return path.join(leadsDir(), "registry.jsonl");
}

function sequencePath() {
  return path.join(leadsDir(), "SEQUENCE.txt");
}

function cardsDir() {
  return path.join(leadsDir(), "cards");
}

function targetsPath() {
  return path.join(leadsDir(), "targets.json");
}

function openclawConfigPath() {
  return path.join(workspaceRoot(), "..", "openclaw.json");
}

function ensureDirs() {
  fs.mkdirSync(leadsDir(), { recursive: true });
  fs.mkdirSync(cardsDir(), { recursive: true });
  if (!fs.existsSync(registryPath())) fs.writeFileSync(registryPath(), "", "utf8");
  if (!fs.existsSync(sequencePath())) fs.writeFileSync(sequencePath(), "0", "utf8");
}

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const raw = token.slice(2);
    if (!raw) continue;

    if (raw.includes("=")) {
      const [key, ...rest] = raw.split("=");
      out[key] = rest.join("=");
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[raw] = next;
      i += 1;
      continue;
    }

    out[raw] = true;
  }
  return out;
}

function loadInput() {
  const cli = parseCliArgs(process.argv.slice(3));
  const raw = readStdin().trim();
  if (!raw) return cli;
  return { ...cli, ...JSON.parse(raw) };
}

function clean(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ");
  return value;
}

function pickFirst(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned !== "") return cleaned;
  }
  return "";
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Boolean(value);
  if (typeof value === "string") {
    return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
  }
  return false;
}

function looksLikeArea(value) {
  const text = clean(value).toLowerCase();
  if (!text) return false;
  return /м²|м2|m²|m2|кв\.?\s?м|квадрат|sq\.?\s?m/.test(text);
}

function normalizeRequestedNextStep(value) {
  const text = clean(value);
  const normalized = text.toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("рассроч")) return "подключить менеджера для консультации по рассрочке";
  if (normalized.includes("брон")) return "подключить менеджера для консультации и бронирования";
  if (normalized.includes("менедж")) return "подключить менеджера";
  return text;
}

function normalizeRecord(input) {
  const record = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const incoming = key in input ? input[key] : fallback;
    record[key] = Array.isArray(incoming) ? incoming : clean(incoming);
  }

  const objectId = pickFirst(input.object_id, input.facility_id, input.catalog_object_id);
  const objectName = pickFirst(input.object_name, input.facility_name, input.complex_name);
  const objectReference = objectName ? `${objectName}${objectId ? ` (ID: ${objectId})` : ""}` : "";
  const formatValue = pickFirst(input.format, input.size_range, input.area_range);
  const formatLooksLikeArea = looksLikeArea(formatValue);

  record.name = pickFirst(record.name, input.sender_name, input.client_name);
  record.contact = pickFirst(record.contact, input.phone, input.telegram_handle);
  record.telegram_username = pickFirst(
    record.telegram_username,
    input.sender_username,
    input.telegram_username,
    input.telegram_handle,
  );
  record.telegram_user_id = pickFirst(
    record.telegram_user_id,
    input.sender_id,
    input.telegram_id,
    input.user_id,
  );
  record.region = pickFirst(record.region, input.market, input.location, input.region_label);
  record.project_type = pickFirst(
    record.project_type,
    input.project_type,
    input.object_type,
    formatLooksLikeArea ? "" : formatValue,
  );
  record.units = pickFirst(
    record.units,
    input.units,
    input.area,
    input.square,
    formatLooksLikeArea ? formatValue : "",
  );
  record.model_or_use_case = pickFirst(
    record.model_or_use_case,
    input.model_or_use_case,
    input.use_case,
    input.goal,
  );
  record.key_need = pickFirst(
    record.key_need,
    input.key_need,
    input.interest,
    input.object_interest,
    objectReference,
    input.intent,
  );
  record.requested_next_step = pickFirst(
    record.requested_next_step,
    input.requested_next_step,
    input.next_step,
    normalizeRequestedNextStep(input.action),
    inferNextStep(input),
  );
  record.summary = pickFirst(
    record.summary,
    input.summary,
    input.message,
    input.intent,
    input.brief,
  );
  record.source = pickFirst(record.source, input.source, input.channel);
  record.thread = pickFirst(
    record.thread,
    input.thread,
    input.chat_id && input.topic_id ? `${input.chat_id}:topic:${input.topic_id}` : "",
    input.chat_id,
  );

  record.__force_new = boolValue(input.force_new);
  if (!record.stage) record.stage = record.status || "qualified";
  if (!record.status) record.status = record.stage || "qualified";
  if (!record.priority) record.priority = inferPriority(record);
  record.summary = pickFirst(record.summary, buildSummary(record));
  return record;
}

function inferNextStep(input) {
  const text = [
    input.requested_next_step,
    input.next_step,
    input.action,
    input.intent,
    input.summary,
    input.message,
  ]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (!text) return "";
  if (text.includes("рассроч")) return "подключить менеджера для консультации по рассрочке";
  if (text.includes("брон")) return "подключить менеджера для консультации и бронирования";
  if (text.includes("менедж")) return "подключить менеджера";
  return "";
}

function buildSummary(record) {
  const nextStep = normalizeRequestedNextStep(record.requested_next_step);
  const nextStepLabel = nextStep
    ? nextStep.includes("брон")
      ? "нужна бронь через менеджера"
      : nextStep.includes("рассроч")
        ? "нужна консультация по рассрочке"
        : nextStep.includes("менедж")
          ? "нужна консультация менеджера"
          : nextStep
    : "";

  return [
    clean(record.key_need),
    clean(record.model_or_use_case),
    clean(record.budget) ? `бюджет ${clean(record.budget)}` : "",
    clean(record.units) ? `площадь ${clean(record.units)}` : "",
    nextStepLabel,
  ]
    .filter(Boolean)
    .join(", ");
}

function displayStage(value) {
  const normalized = clean(value).toLowerCase();
  if (normalized === "qualified") return "квалифицирован";
  if (normalized === "routed") return "передан";
  if (normalized === "closed_won") return "успешно закрыт";
  if (normalized === "closed_lost") return "закрыт без сделки";
  return value || "";
}

function inferPriority(record) {
  const text = [
    record.project_type,
    record.model_or_use_case,
    record.key_need,
    record.requested_next_step,
    record.risks,
  ].join(" ").toLowerCase();

  if (["подбор", "shortlist", "calc", "расчет", "менедж", "звон", "call"].some((token) => text.includes(token))) {
    return "высокий";
  }
  if (["доход", "yield", "рост", "портф", "диверсиф", "рынок"].some((token) => text.includes(token))) {
    return "средний";
  }
  return "обычный";
}

function loadRegistry() {
  ensureDirs();
  const map = {};
  const raw = fs.readFileSync(registryPath(), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.lead_id) map[row.lead_id] = row;
    } catch {
      // keep the registry robust even if one line is malformed
    }
  }
  return map;
}

function saveRegistry(records) {
  const rows = Object.values(records).sort((a, b) => numericLeadId(a.lead_id) - numericLeadId(b.lead_id));
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(registryPath(), body ? `${body}\n` : "", "utf8");
}

function numericLeadId(leadId) {
  const match = String(leadId || "").match(/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function nextLeadId(records) {
  const currentRaw = fs.readFileSync(sequencePath(), "utf8").trim();
  const current = /^\d+$/.test(currentRaw) ? Number.parseInt(currentRaw, 10) : 0;
  const next = Math.max(current, ...Object.keys(records).map(numericLeadId), 0) + 1;
  fs.writeFileSync(sequencePath(), String(next), "utf8");
  return `SC-${String(next).padStart(4, "0")}`;
}

function isActive(record) {
  return !["closed_won", "closed_lost"].includes(record.status);
}

function matchExisting(records, candidate) {
  if (candidate.__force_new) return null;

  const telegramUserId = String(candidate.telegram_user_id || "");
  const contact = String(candidate.contact || "").toLowerCase();
  const thread = String(candidate.thread || "");
  const source = String(candidate.source || "");

  for (const record of Object.values(records)) {
    if (!isActive(record)) continue;
    if (telegramUserId && String(record.telegram_user_id || "") === telegramUserId) return record;
  }
  for (const record of Object.values(records)) {
    if (!isActive(record)) continue;
    if (contact && String(record.contact || "").toLowerCase() === contact) return record;
  }
  for (const record of Object.values(records)) {
    if (!isActive(record)) continue;
    // In shared group topics, thread/source alone is too weak when we already
    // know who the sender is. Only fall back to thread matching if there is no
    // direct identity signal such as Telegram user id or explicit contact.
    if (!telegramUserId && !contact && thread && source && record.thread === thread && record.source === source) {
      return record;
    }
  }
  return null;
}

function mergeRecord(existing, incoming) {
  const out = structuredClone(existing);
  for (const [key, value] of Object.entries(incoming)) {
    if (["lead_id", "created_at", "__force_new"].includes(key)) continue;
    const emptyScalar = value === "" || value === null || value === undefined;
    const emptyArray = Array.isArray(value) && value.length === 0;
    if (!emptyScalar && !emptyArray) out[key] = value;
  }
  out.updated_at = now();
  if (!out.priority) out.priority = inferPriority(out);
  return out;
}

function upsertLead(input) {
  const incoming = normalizeRecord(input);
  const records = loadRegistry();
  const requestedLeadId = clean(input.lead_id);
  const existing = (requestedLeadId && records[requestedLeadId]) || matchExisting(records, incoming);
  const leadId = existing?.lead_id || requestedLeadId || nextLeadId(records);
  const base = existing || {
    ...DEFAULTS,
    lead_id: leadId,
    created_at: now(),
    updated_at: now(),
    status: "qualified",
    stage: "qualified",
  };

  const merged = mergeRecord(base, incoming);
  merged.lead_id = leadId;
  if (!merged.created_at) merged.created_at = now();
  if (!merged.updated_at) merged.updated_at = now();
  if (!Array.isArray(merged.manager_delivery_log)) merged.manager_delivery_log = [];
  if (!Array.isArray(merged.manager_route_targets)) merged.manager_route_targets = [];

  records[leadId] = merged;
  saveRegistry(records);
  writeCard(merged);
  return merged;
}

function previewLeadForRouting(input) {
  const incoming = normalizeRecord(input);
  const records = loadRegistry();
  const requestedLeadId = clean(input.lead_id);
  const existing = (requestedLeadId && records[requestedLeadId]) || matchExisting(records, incoming);
  const base = existing || {
    ...DEFAULTS,
    lead_id: requestedLeadId || "SC-preview",
    created_at: now(),
    updated_at: now(),
    status: "qualified",
    stage: "qualified",
  };

  return mergeRecord(base, incoming);
}

function formatTelegramUsername(value) {
  const normalized = clean(value);
  if (!normalized) return "";
  return normalized.startsWith("@") ? normalized : `@${normalized}`;
}

function contactRows(record, { includeSensitiveIds = false } = {}) {
  const username = formatTelegramUsername(record.telegram_username);
  const contact = clean(record.contact);
  const norm = (value) => String(value || "").trim().toLowerCase();
  const name = clean(record.name);
  const nameLine = name && norm(name) !== norm(username) && norm(name) !== norm(contact)
    ? `- Имя: ${name}`
    : null;
  const contactLine = contact && norm(contact) !== norm(username)
    ? `- Связь: ${contact}`
    : null;
  const userIdLine = includeSensitiveIds && clean(record.telegram_user_id)
    ? `- Telegram user id: ${record.telegram_user_id}`
    : null;
  return [
    nameLine,
    username ? `- Telegram: ${username}` : null,
    contactLine,
    userIdLine,
  ];
}

function renderLine(label, value, formatter = (v) => String(v)) {
  if (value === "" || value === null || value === undefined) return null;
  return `- ${label}: ${formatter(value)}`;
}

function pushSection(lines, title, rows) {
  const filtered = rows.filter(Boolean);
  if (!filtered.length) return;
  if (lines.length) lines.push("");
  lines.push(title, ...filtered);
}

function renderManagerCard(record) {
  const titleName = clean(record.name) || formatTelegramUsername(record.telegram_username) || clean(record.contact) || "без имени";
  const title = `Новый лид Shirokov Capital · ${record.lead_id} · ${titleName}`;
  const lines = [title];

  pushSection(lines, "Статус", [
    renderLine("Приоритет", record.priority),
    renderLine("Стадия", displayStage(record.stage || record.status)),
    renderLine("Что нужно от менеджера", record.requested_next_step),
  ]);

  pushSection(lines, "Контакт", [
    ...contactRows(record, { includeSensitiveIds: true }),
  ]);

  pushSection(lines, "Сделка", [
    renderLine("Рынок / локация", record.region),
    renderLine("Формат объекта", record.project_type),
    renderLine("Сценарий", record.model_or_use_case),
    renderLine("Горизонт", record.timeline),
    renderLine("Бюджет / чек", record.budget),
    renderLine("Масштаб", record.units),
  ]);

  pushSection(lines, "Суть", [
    renderLine("Ключевой запрос", record.key_need),
    renderLine("Важные нюансы", record.risks),
  ]);

  pushSection(lines, "Короткое резюме", record.summary ? [`- ${record.summary}`] : []);

  return lines.join("\n");
}

function renderCardMarkdown(record) {
  const titleName = clean(record.name) || formatTelegramUsername(record.telegram_username) || clean(record.contact) || "без имени";
  const lines = [
    `# Лид ${record.lead_id} — ${titleName}${record.region ? ` / ${record.region}` : ""}`,
  ];

  pushSection(lines, "## Статус", [
    renderLine("Приоритет", record.priority),
    renderLine("Стадия", displayStage(record.stage || record.status)),
    renderLine("Последнее обновление", record.updated_at),
    renderLine("Что нужно дальше", record.requested_next_step),
  ]);

  pushSection(lines, "## Контакт", contactRows(record, { includeSensitiveIds: true }));

  pushSection(lines, "## Сделка", [
    renderLine("Рынок / локация", record.region),
    renderLine("Формат объекта", record.project_type),
    renderLine("Сценарий", record.model_or_use_case),
    renderLine("Горизонт", record.timeline),
    renderLine("Бюджет / чек", record.budget),
    renderLine("Масштаб", record.units),
  ]);

  pushSection(lines, "## Суть", [
    renderLine("Ключевой запрос", record.key_need),
    renderLine("Важные нюансы", record.risks),
  ]);

  pushSection(lines, "## Короткое резюме", record.summary ? [`- ${record.summary}`] : []);

  return `${lines.join("\n")}\n`;
}

function writeCard(record) {
  fs.mkdirSync(cardsDir(), { recursive: true });
  fs.writeFileSync(path.join(cardsDir(), `${record.lead_id}.md`), renderCardMarkdown(record), "utf8");
}

function loadJSON(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function telegramToken() {
  const config = loadJSON(openclawConfigPath(), {});
  return config?.channels?.telegram?.botToken || "";
}

function telegramPost(method, payload) {
  const token = telegramToken();
  if (!token) {
    throw new Error("telegram bot token is not configured in openclaw.json");
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          try {
            const parsed = JSON.parse(raw || "{}");
            if (!parsed.ok) {
              reject(new Error(parsed.description || `${method} failed`));
              return;
            }
            resolve(parsed.result);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function buildTargets(config) {
  const out = [];
  if (config?.primary_sales_chat_id) {
    out.push({
      kind: "primary",
      chat_id: config.primary_sales_chat_id,
      message_thread_id: config.primary_sales_message_thread_id || null,
    });
  }
  if (config?.duplicate_direct_delivery && Array.isArray(config.direct_manager_targets)) {
    for (const target of config.direct_manager_targets) {
      if (target?.chat_id || target?.user_id) {
        out.push({
          kind: "manager",
          name: target.name || "manager",
          chat_id: target.chat_id || target.user_id,
          user_id: target.user_id || null,
          message_thread_id: null,
        });
      }
    }
  }
  return out;
}

function findDeliveryLog(record, target) {
  const logs = Array.isArray(record.manager_delivery_log) ? record.manager_delivery_log : [];
  return logs.find((entry) => {
    return String(entry.chat_id || "") === String(target.chat_id || "") &&
      String(entry.message_thread_id || "") === String(target.message_thread_id || "") &&
      String(entry.kind || "") === String(target.kind || "");
  });
}

async function deliverToTelegram(record) {
  const config = loadJSON(targetsPath(), {});
  const targets = buildTargets(config);
  if (!targets.length) {
    throw new Error("no manager routing targets configured");
  }

  const messageText = renderManagerCard(record);
  const log = Array.isArray(record.manager_delivery_log) ? [...record.manager_delivery_log] : [];
  const routedTargets = [];

  for (const target of targets) {
    const existing = findDeliveryLog(record, target);
    let result;
    if (existing?.message_id) {
      try {
        result = await telegramPost("editMessageText", {
          chat_id: target.chat_id,
          message_id: existing.message_id,
          text: messageText,
        });
      } catch (error) {
        if (String(error?.message || "").includes("message is not modified")) {
          result = { message_id: existing.message_id };
        } else {
          throw error;
        }
      }
    } else {
      result = await telegramPost("sendMessage", {
        chat_id: target.chat_id,
        message_thread_id: target.message_thread_id || undefined,
        text: messageText,
      });
    }
    const messageId = result?.message_id;
    const nextLog = {
      kind: target.kind,
      chat_id: target.chat_id,
      user_id: target.user_id || null,
      message_thread_id: target.message_thread_id || null,
      message_id: messageId || existing?.message_id || null,
      updated_at: now(),
    };

    const existingIndex = log.findIndex((entry) => {
      return String(entry.chat_id || "") === String(nextLog.chat_id || "") &&
        String(entry.message_thread_id || "") === String(nextLog.message_thread_id || "") &&
        String(entry.kind || "") === String(nextLog.kind || "");
    });

    if (existingIndex >= 0) {
      log[existingIndex] = nextLog;
    } else {
      log.push(nextLog);
    }
    routedTargets.push(target.kind === "primary" ? `topic:${target.chat_id}:${target.message_thread_id || 0}` : `user:${target.user_id || target.chat_id}`);
  }

  return { log, routedTargets };
}

async function routeManager(input) {
  validateLeadForRouting(previewLeadForRouting(input));
  const lead = upsertLead(input);
  lead.status = "routed";
  lead.stage = "routed";
  const delivery = await deliverToTelegram(lead);
  lead.manager_delivery_log = delivery.log;
  lead.manager_route_targets = delivery.routedTargets;
  lead.manager_routed_at = now();

  const records = loadRegistry();
  records[lead.lead_id] = lead;
  saveRegistry(records);
  writeCard(lead);

  return lead;
}

function validateLeadForRouting(lead) {
  const hasIdentity = Boolean(
    clean(lead.telegram_user_id) ||
    clean(lead.telegram_username) ||
    clean(lead.contact) ||
    clean(lead.name) ||
    clean(lead.thread),
  );
  const hasCommercialContext = Boolean(
    clean(lead.key_need) ||
    clean(lead.summary) ||
    clean(lead.requested_next_step) ||
    clean(lead.region) ||
    clean(lead.project_type) ||
    clean(lead.model_or_use_case),
  );

  if (!hasIdentity) {
    throw new Error("lead routing requires at least one identity field");
  }
  if (!hasCommercialContext) {
    throw new Error("lead routing requires commercial context before delivery");
  }
}

function customerConfirmation() {
  return "Готово. Я передал ваш запрос команде Shirokov Capital. Они свяжутся с вами здесь или в Telegram в ближайшее рабочее время.";
}

async function main() {
  ensureDirs();
  const command = process.argv[2] || "upsert";
  const input = loadInput();

  if (command === "upsert") {
    upsertLead(input);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      action: "saved",
      registry_updated: true,
      customer_confirmation: "Запрос сохранен во внутренней базе.",
      internal_lead_id_hidden: true,
    })}\n`);
    return;
  }

  if (command === "route-manager") {
    const lead = await routeManager(input);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      delivery_completed: true,
      successful_targets: lead.manager_route_targets || [],
      customer_confirmation: customerConfirmation(),
      manager_status: "Запрос доставлен менеджерам.",
      internal_lead_id_hidden: true,
    })}\n`);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
