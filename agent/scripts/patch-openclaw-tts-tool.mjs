import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const candidateTargets = [
  process.argv[2],
  "/home/claworc/.npm-global/lib/node_modules/openclaw/dist/pi-embedded-CchuaggU.js",
  "/usr/lib/node_modules/openclaw/dist/pi-embedded-CchuaggU.js",
  "/usr/local/lib/node_modules/openclaw/dist/pi-embedded-CchuaggU.js",
].filter(Boolean);

const distDirs = [
  "/home/claworc/.npm-global/lib/node_modules/openclaw/dist",
  "/usr/lib/node_modules/openclaw/dist",
  "/usr/local/lib/node_modules/openclaw/dist",
];

let target = candidateTargets.find((filePath) => existsSync(filePath));

if (!target) {
  for (const dirPath of distDirs) {
    if (!existsSync(dirPath)) continue;
    for (const entry of readdirSync(dirPath)) {
      if (!entry.endsWith(".js")) continue;
      const filePath = path.join(dirPath, entry);
      const text = readFileSync(filePath, "utf8");
      if (text.includes("src/agents/tools/tts-tool.ts") && text.includes('name: "tts"')) {
        target = filePath;
        break;
      }
    }
    if (target) break;
  }
}

if (!target) {
  throw new Error(`OpenClaw bundle not found in: ${[...candidateTargets, ...distDirs].join(", ")}`);
}

const source = readFileSync(target, "utf8");

const after = `const text = readStringParam$1(params, "text", { required: true });
				const channel = readStringParam$1(params, "channel");
				const cfg = opts?.config ?? loadConfig();
				const ttsConfig = resolveTtsConfig(cfg);
				const prefsPath = resolveTtsPrefsPath(ttsConfig);
				const softMax = Math.max(10, getTtsMaxLength(prefsPath) || ttsConfig.maxTextLength || 220);
				const hardMax = Math.max(10, ttsConfig.maxTextLength || softMax);
				const ellipsize = (value, limit) => value.length <= limit ? value : \`\${value.slice(0, Math.max(1, limit - 3))}...\`;
				let spokenText = stripMarkdown(text).trim();
				if (spokenText.length > softMax) if (!isSummarizationEnabled(prefsPath)) spokenText = ellipsize(spokenText, softMax); else try {
					spokenText = (await summarizeText({
						text: spokenText,
						targetLength: softMax,
						cfg,
						config: ttsConfig,
						timeoutMs: ttsConfig.timeoutMs
					})).summary;
				} catch (err) {
					logVerbose(\`TTS tool: summarization failed, truncating instead: \${err.message}\`);
					spokenText = ellipsize(spokenText, softMax);
				}
				spokenText = ellipsize(stripMarkdown(spokenText).trim(), hardMax);
				const result = await textToSpeech({
					text: spokenText,
					cfg,
					channel: channel ?? opts?.agentChannel
				});`;

const beforePattern = /const text = readStringParam\$1\(params, "text", \{ required: true \}\);\n[\t ]+const channel = readStringParam\$1\(params, "channel"\);\n[\s\S]{0,80}?const result = await textToSpeech\(\{\n[\t ]+text,\n[\t ]+cfg: opts\?\.config \?\? loadConfig\(\),\n[\t ]+channel: channel \?\? opts\?\.agentChannel\n[\t ]+\}\);/;

if (source.includes(after)) {
  console.log(`Already patched: ${target}`);
  process.exit(0);
}

if (!beforePattern.test(source)) {
  throw new Error(`Expected snippet not found in ${target}`);
}

writeFileSync(target, source.replace(beforePattern, after), "utf8");
console.log(`Patched: ${target}`);
