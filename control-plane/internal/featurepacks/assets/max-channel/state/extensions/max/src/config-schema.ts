import {
  AllowFromListSchema,
  buildCatchallMultiAccountChannelSchema,
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
} from "openclaw/plugin-sdk/channel-config-schema";
import { buildSecretInputSchema } from "openclaw/plugin-sdk/secret-input";
import { z } from "openclaw/plugin-sdk/zod";

const maxAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  markdown: MarkdownConfigSchema,
  botToken: buildSecretInputSchema().optional(),
  tokenFile: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  webhookSecret: buildSecretInputSchema().optional(),
  webhookPath: z.string().optional(),
  dmPolicy: DmPolicySchema.optional(),
  allowFrom: AllowFromListSchema,
  groupPolicy: GroupPolicySchema.optional(),
  groupAllowFrom: AllowFromListSchema,
  proxy: z.string().optional(),
  responsePrefix: z.string().optional(),
  useLongPoll: z.boolean().optional(),
  format: z.enum(["markdown", "html", "plain"]).optional(),
  apiBaseUrl: z.string().url().optional(),
  requestsPerSecond: z.number().positive().max(30).optional(),
});

export const MaxConfigSchema = buildCatchallMultiAccountChannelSchema(maxAccountSchema);
