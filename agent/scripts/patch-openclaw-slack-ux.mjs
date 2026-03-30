#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const bufferSize = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "32";
let loadingMessages;
try {
  loadingMessages = JSON.parse(
    process.argv[3] ?? '["Thinking","Analyzing","Planning","Drafting","Polishing"]',
  );
  if (!Array.isArray(loadingMessages) || loadingMessages.length === 0) {
    throw new Error("loadingMessages must be a non-empty array");
  }
} catch {
  loadingMessages = ["Thinking", "Analyzing", "Planning", "Drafting", "Polishing"];
}
const minLoadingMs = /^\d+$/.test(process.argv[4] ?? "") ? process.argv[4] : "6500";

const configuredActiveRoot = (process.env.OPENCLAW_ACTIVE_DIST_DIR ?? "").trim();
const roots = Array.from(new Set([
  configuredActiveRoot || null,
  "/home/claworc/.npm-global/lib/node_modules/openclaw/dist",
  "/usr/lib/node_modules/openclaw/dist",
].filter(Boolean)));

const loadingMessagesJs = `[${loadingMessages.map((item) => JSON.stringify(String(item))).join(", ")}]`;

const replacements = [
  [
    "const streamer = client.chatStream({\n\t\t\tchannel,\n\t\t\tthread_ts: threadTs,\n\t\t\t...teamId ? { recipient_team_id: teamId } : {},\n\t\t\t...userId ? { recipient_user_id: userId } : {}\n\t\t});",
    `const streamer = client.chatStream({\n\t\t\tchannel,\n\t\t\tthread_ts: threadTs,\n\t\t\t...teamId ? { recipient_team_id: teamId } : {},\n\t\t\t...userId ? { recipient_user_id: userId } : {},\n\t\t\tbuffer_size: ${bufferSize}\n\t\t});`,
  ],
  [
    "const streamer = client.chatStream({\n\t\t\tchannel,\n\t\t\tthread_ts: threadTs,\n\t\t\t...teamId ? { recipient_team_id: teamId } : {},\n\t\t\t...userId ? { recipient_user_id: userId } : {},\n\t\t\tbuffer_size: 32\n\t\t});",
    `const streamer = client.chatStream({\n\t\t\tchannel,\n\t\t\tthread_ts: threadTs,\n\t\t\t...teamId ? { recipient_team_id: teamId } : {},\n\t\t\t...userId ? { recipient_user_id: userId } : {},\n\t\t\tbuffer_size: ${bufferSize}\n\t\t});`,
  ],
  [
    "function buildStatusFinalPreviewText(updateCount) {\n\treturn `Status: thinking${\".\".repeat(Math.max(1, updateCount) % 3 + 1)}`;\n}",
    'function buildStatusFinalPreviewText(updateCount) {\n\tconst phases = ["Thinking", "Analyzing", "Planning", "Drafting", "Polishing"];\n\tconst normalized = Math.max(1, updateCount);\n\tconst phase = phases[(normalized - 1) % phases.length];\n\tconst dots = ".".repeat((normalized - 1) % 3 + 1);\n\treturn `${phase}${dots}`;\n}',
  ],
  [
    "const payload = {\n\t\t\ttoken: params.botToken,\n\t\t\tchannel_id: p.channelId,\n\t\t\tthread_ts: p.threadTs,\n\t\t\tstatus: p.status\n\t\t};",
    `const payload = {\n\t\t\ttoken: params.botToken,\n\t\t\tchannel_id: p.channelId,\n\t\t\tthread_ts: p.threadTs,\n\t\t\tstatus: p.status,\n\t\t\t...Array.isArray(p.loadingMessages) && p.loadingMessages.length > 0 ? {\n\t\t\t\tloading_messages: p.loadingMessages\n\t\t\t} : {}\n\t\t};`,
  ],
  [
    'await ctx.setSlackThreadStatus({\n\t\t\t\t\tchannelId: message.channel,\n\t\t\t\t\tthreadTs: statusThreadTs,\n\t\t\t\t\tstatus: "is typing..."\n\t\t\t\t});',
    `await ctx.setSlackThreadStatus({\n\t\t\t\t\tchannelId: message.channel,\n\t\t\t\t\tthreadTs: statusThreadTs,\n\t\t\t\t\tstatus: "Thinking",\n\t\t\t\t\tloadingMessages: ${loadingMessagesJs}\n\t\t\t\t});`,
  ],
  [
    "const incomingThreadTs = message.thread_ts;\n\tlet didSetStatus = false;",
    `const incomingThreadTs = message.thread_ts;\n\tlet didSetStatus = false;\n\tlet typingStartedAt = 0;\n\tconst minSlackLoadingMs = ${minLoadingMs};\n\tconst ensureSlackLoadingWindow = async () => {\n\t\tif (!typingStartedAt || minSlackLoadingMs <= 0) return;\n\t\tconst remaining = minSlackLoadingMs - (Date.now() - typingStartedAt);\n\t\tif (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));\n\t};`,
  ],
  [
    "\t});\n\tconst slackStreaming = resolveSlackStreamingConfig({",
    "\t});\n\tawait replyPipeline.typingCallbacks?.onReplyStart?.();\n\tconst slackStreaming = resolveSlackStreamingConfig({",
  ],
  [
    "start: async () => {\n\t\t\t\tdidSetStatus = true;",
    "start: async () => {\n\t\t\t\tdidSetStatus = true;\n\t\t\t\ttypingStartedAt = Date.now();",
  ],
  [
    "const replyThreadTs = forcedThreadTs ?? replyPlan.nextThreadTs();\n\t\tawait deliverReplies({",
    "const replyThreadTs = forcedThreadTs ?? replyPlan.nextThreadTs();\n\t\tif (!hasRepliedRef.value && !streamSession) await ensureSlackLoadingWindow();\n\t\tawait deliverReplies({",
  ],
  [
    "if (!streamSession) {\n\t\t\t\tconst streamThreadTs = replyPlan.nextThreadTs();",
    "if (!streamSession) {\n\t\t\t\tawait ensureSlackLoadingWindow();\n\t\t\t\tconst streamThreadTs = replyPlan.nextThreadTs();",
  ],
];

function patchFile(filePath) {
  let text = fs.readFileSync(filePath, "utf8");
  const original = text;
  const slackLoadingBlock =
    `const incomingThreadTs = message.thread_ts;\n\tlet didSetStatus = false;\n\tlet typingStartedAt = 0;\n\tconst minSlackLoadingMs = ${minLoadingMs};\n\tconst ensureSlackLoadingWindow = async () => {\n\t\tif (!typingStartedAt || minSlackLoadingMs <= 0) return;\n\t\tconst remaining = minSlackLoadingMs - (Date.now() - typingStartedAt);\n\t\tif (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));\n\t};`;
  for (const [before, after] of replacements) {
    if (text.includes(before)) {
      text = text.replace(before, after);
    }
  }
  text = text.replace(
    /const incomingThreadTs = message\.thread_ts;\n\tlet didSetStatus = false;(?:\n\tlet typingStartedAt = 0;\n\tconst minSlackLoadingMs = \d+;\n\tconst ensureSlackLoadingWindow = async \(\) => \{\n\t\tif \(!typingStartedAt \|\| minSlackLoadingMs <= 0\) return;\n\t\tconst remaining = minSlackLoadingMs - \(Date\.now\(\) - typingStartedAt\);\n\t\tif \(remaining > 0\) await new Promise\(\(resolve\) => setTimeout\(resolve, remaining\)\);\n\t\};)+/,
    slackLoadingBlock,
  );
  text = text.replace(
    /(?:\tawait replyPipeline\.typingCallbacks\?\.onReplyStart\?\.\(\);\n)+\tconst slackStreaming = resolveSlackStreamingConfig\(\{/,
    "\tawait replyPipeline.typingCallbacks?.onReplyStart?.();\n\tconst slackStreaming = resolveSlackStreamingConfig({",
  );
  text = text.replace(
    /start: async \(\) => \{\n\t\t\t\tdidSetStatus = true;(?:\n\t\t\t\ttypingStartedAt = Date\.now\(\);)+/,
    "start: async () => {\n\t\t\t\tdidSetStatus = true;\n\t\t\t\ttypingStartedAt = Date.now();",
  );
  text = text.replace(
    /const streamer = client\.chatStream\(\{\n(\s*)channel,\n\1thread_ts: threadTs,\n\1\.\.\.teamId \? \{ recipient_team_id: teamId \} : \{\},\n\1\.\.\.userId \? \{ recipient_user_id: userId \} : \{\}(?:,\n\1buffer_size: \d+)?\n\t\}\);/,
    (_, indent) =>
      `const streamer = client.chatStream({\n${indent}channel,\n${indent}thread_ts: threadTs,\n${indent}...teamId ? { recipient_team_id: teamId } : {},\n${indent}...userId ? { recipient_user_id: userId } : {},\n${indent}buffer_size: ${bufferSize}\n\t\t});`,
  );
  if (!text.includes(`const minSlackLoadingMs = ${minLoadingMs};`)) {
    text = text.replace(
      "const incomingThreadTs = message.thread_ts;\n\tlet didSetStatus = false;",
      slackLoadingBlock,
    );
  }
  if (!text.includes("await replyPipeline.typingCallbacks?.onReplyStart?.();")) {
    text = text.replace(
      "\t});\n\tconst slackStreaming = resolveSlackStreamingConfig({",
      "\t});\n\tawait replyPipeline.typingCallbacks?.onReplyStart?.();\n\tconst slackStreaming = resolveSlackStreamingConfig({",
    );
  }
  if (!text.includes("typingStartedAt = Date.now();")) {
    text = text.replace(
      "start: async () => {\n\t\t\t\tdidSetStatus = true;",
      "start: async () => {\n\t\t\t\tdidSetStatus = true;\n\t\t\t\ttypingStartedAt = Date.now();",
    );
  }
  if (!text.includes("if (!hasRepliedRef.value && !streamSession) await ensureSlackLoadingWindow();")) {
    text = text.replace(
      "const replyThreadTs = forcedThreadTs ?? replyPlan.nextThreadTs();\n\t\tawait deliverReplies({",
      "const replyThreadTs = forcedThreadTs ?? replyPlan.nextThreadTs();\n\t\tif (!hasRepliedRef.value && !streamSession) await ensureSlackLoadingWindow();\n\t\tawait deliverReplies({",
    );
  }
  if (!text.includes("await ensureSlackLoadingWindow();\n\t\t\t\tconst streamThreadTs = replyPlan.nextThreadTs();")) {
    text = text.replace(
      "if (!streamSession) {\n\t\t\t\tconst streamThreadTs = replyPlan.nextThreadTs();",
      "if (!streamSession) {\n\t\t\t\tawait ensureSlackLoadingWindow();\n\t\t\t\tconst streamThreadTs = replyPlan.nextThreadTs();",
    );
  }
  text = text.replace(
    "if (statusUpdateCount > 1 && statusUpdateCount % 4 !== 0) return;",
    "if (statusUpdateCount > 1 && statusUpdateCount % 2 !== 0) return;",
  );
  if (text !== original) {
    fs.writeFileSync(filePath, text);
    return true;
  }
  return false;
}

function verifyFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return (
    text.includes(`buffer_size: ${bufferSize}`) &&
    text.includes("loading_messages: p.loadingMessages") &&
    text.includes('status: "Thinking"') &&
    text.includes(`const minSlackLoadingMs = ${minLoadingMs};`) &&
    text.includes("await replyPipeline.typingCallbacks?.onReplyStart?.();") &&
    text.includes("start: async () => {\n\t\t\t\tdidSetStatus = true;\n\t\t\t\ttypingStartedAt = Date.now();") &&
    !text.includes("const minSlackLoadingMs = 2400;")
  );
}

let patchedCount = 0;
let verifiedCount = 0;
let verifiedActiveCount = 0;

for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const name of fs.readdirSync(root)) {
    if (!name.startsWith("runtime-api-") || !name.endsWith(".js")) continue;
    const filePath = path.join(root, name);
    const text = fs.readFileSync(filePath, "utf8");
    if (!text.includes("setSlackThreadStatus") || !text.includes("chatStream({")) continue;
    if (patchFile(filePath)) patchedCount += 1;
    if (verifyFile(filePath)) {
      verifiedCount += 1;
      if (configuredActiveRoot && path.resolve(root) === path.resolve(configuredActiveRoot)) {
        verifiedActiveCount += 1;
      }
    }
  }
}

console.log(
  `Slack UX patch: patched=${patchedCount} verified=${verifiedCount} verifiedActive=${verifiedActiveCount} buffer=${bufferSize} minLoadingMs=${minLoadingMs}`,
);

if (configuredActiveRoot) {
  if (verifiedActiveCount === 0) {
    console.error(`Slack UX patch target not found in active OpenClaw runtime: ${configuredActiveRoot}`);
    process.exit(1);
  }
} else if (verifiedCount === 0) {
  console.error("Slack UX patch target not found in any OpenClaw runtime");
  process.exit(1);
}
