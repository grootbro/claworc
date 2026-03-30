import {
  AllowFromListSchema,
  buildCatchallMultiAccountChannelSchema,
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
} from "openclaw/plugin-sdk/channel-config-schema";
import { buildSecretInputSchema } from "openclaw/plugin-sdk/secret-input";
import { z } from "openclaw/plugin-sdk/zod";

const vkAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  markdown: MarkdownConfigSchema,
  accessToken: buildSecretInputSchema().optional(),
  tokenFile: z.string().optional(),
  groupId: z.union([z.string(), z.number()]).optional(),
  apiVersion: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  webhookSecret: buildSecretInputSchema().optional(),
  webhookPath: z.string().optional(),
  callbackSecret: buildSecretInputSchema().optional(),
  confirmationToken: buildSecretInputSchema().optional(),
  dmPolicy: DmPolicySchema.optional(),
  allowFrom: AllowFromListSchema,
  groupPolicy: GroupPolicySchema.optional(),
  groupAllowFrom: AllowFromListSchema,
  markAsRead: z.boolean().optional(),
  useLongPoll: z.boolean().optional(),
  proxy: z.string().optional(),
  responsePrefix: z.string().optional(),
});

export const VkConfigSchema = buildCatchallMultiAccountChannelSchema(vkAccountSchema);
