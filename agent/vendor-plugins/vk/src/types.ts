export type VkTokenSource = "config" | "file" | "env" | "none";

export type VkAccountConfig = {
  name?: string;
  enabled?: boolean;
  markdown?: unknown;
  accessToken?: string;
  tokenFile?: string;
  groupId?: string | number;
  apiVersion?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookPath?: string;
  callbackSecret?: string;
  confirmationToken?: string;
  dmPolicy?: string;
  allowFrom?: Array<string | number>;
  groupPolicy?: string;
  groupAllowFrom?: Array<string | number>;
  markAsRead?: boolean;
  useLongPoll?: boolean;
  proxy?: string;
  responsePrefix?: string;
};

export type VkConfig = VkAccountConfig & {
  defaultAccount?: string;
  accounts?: Record<string, Partial<VkAccountConfig>>;
};

export type ResolvedVkAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  token: string;
  tokenSource: VkTokenSource;
  groupId?: string;
  config: VkAccountConfig;
};
