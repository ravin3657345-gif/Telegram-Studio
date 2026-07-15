import { invoke } from "@tauri-apps/api/core";

export interface BotStatus {
  functionReachable: boolean;
  webhookUrl: string | null;
  pendingUpdateCount: number;
  lastErrorMessage: string | null;
  lastErrorDate: string | null;
  lastLogAt: string | null;
  lastLogMessage: string | null;
}

export interface SaleRow {
  timestamp: string;
  userId: string;
  username: string;
  firstName: string;
  stars: string;
  key: string;
  chargeId: string;
}

export interface InstallerInfo {
  name: string;
  version: string;
  sizeBytes: number;
  modified: string;
  isLatest: boolean;
}

export interface BotConfig {
  starsPrice: number;
  rubPerStar: number;
  adminChatId: string;
  supportContact: string;
}

export interface StarBalance {
  amount: number;
  nanostarAmount: number;
}

export interface BroadcastResult {
  total: number;
  sent: number;
  failed: number;
  failedUserIds: string[];
}

export const api = {
  getBotStatus: () => invoke<BotStatus>("get_bot_status"),
  pauseBot: () => invoke<void>("pause_bot"),
  resumeBot: () => invoke<void>("resume_bot"),
  getSales: () => invoke<SaleRow[]>("get_sales"),
  getLogTail: (lines: number) => invoke<string[]>("get_log_tail", { lines }),
  getInstallers: () => invoke<InstallerInfo[]>("get_installers"),
  uploadInstallerToStorage: (name: string, version: string) =>
    invoke<void>("upload_installer_to_storage", { name, version }),
  getPublishedInstallerVersion: () => invoke<string | null>("get_published_installer_version"),
  getConfig: () => invoke<BotConfig>("get_config"),
  setConfig: (config: BotConfig) => invoke<void>("set_config", { config }),
  generateTestKey: () => invoke<string>("generate_test_key"),
  getStarBalance: () => invoke<StarBalance>("get_star_balance"),
  getBuyerCount: () => invoke<number>("get_buyer_count"),
  broadcastUpdate: (message: string) => invoke<BroadcastResult>("broadcast_update", { message }),
};
