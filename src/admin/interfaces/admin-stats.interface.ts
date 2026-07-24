export interface AdminStats {
  summary: {
    totalRevenue: number;
    totalTransactions: number;
    activeListings: number;
    pendingModeration: number;
  };
  monthlyRevenue: Revenue[];
  moderationDistribution: ModerationDistribution[];
}
export interface Revenue {
  month: string;
  revenue: number;
  transactions: number;
}
export interface ModerationDistribution {
  label: string;
  value: number;
}
