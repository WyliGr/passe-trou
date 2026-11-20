// Wire shape of GET /admin/overview (root API.md).

export interface OverviewCounts {
  providers: number;
  accounts: number;
  models: number;
  members: number;
  keys: number;
}

export interface OverviewToday {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface OverviewAccount {
  id: string;
  label: string;
  provider: string;
  enabled: boolean;
  cooling: boolean;
  todayRequests: number;
  todayCostUsd: number;
}

export interface Overview {
  counts: OverviewCounts;
  today: OverviewToday;
  accounts: OverviewAccount[];
}
