export interface SubscriptionAuthentication {
  prepare(binary: string, authDirectory?: string): Promise<void>;
  login(): Promise<void>;
  status(): Promise<{ ready: boolean }>;
}

export interface ModelSelection {
  readonly model: string;
  readonly effort: string;
}
