export type MaxTokenSource = "config" | "file" | "env" | "none";
export type MaxMessageFormat = "markdown" | "html" | "plain";

export type MaxAccountConfig = {
  name?: string;
  enabled?: boolean;
  markdown?: unknown;
  botToken?: string;
  tokenFile?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookPath?: string;
  dmPolicy?: string;
  allowFrom?: Array<string | number>;
  groupPolicy?: string;
  groupAllowFrom?: Array<string | number>;
  proxy?: string;
  responsePrefix?: string;
  useLongPoll?: boolean;
  format?: MaxMessageFormat;
  apiBaseUrl?: string;
  requestsPerSecond?: number;
};

export type MaxConfig = MaxAccountConfig & {
  defaultAccount?: string;
  accounts?: Record<string, Partial<MaxAccountConfig>>;
};

export type ResolvedMaxAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  token: string;
  tokenSource: MaxTokenSource;
  config: MaxAccountConfig;
};
