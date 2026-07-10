import { invoke } from "@tauri-apps/api/core";

export interface BotStatus {
  running: boolean;
  supervisorRunning: boolean;
  pid: number | null;
  since: string | null;
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

export const api = {
  getBotStatus: () => invoke<BotStatus>("get_bot_status"),
  startBot: () => invoke<void>("start_bot"),
  stopBot: () => invoke<void>("stop_bot"),
  restartBot: () => invoke<void>("restart_bot"),
  getSales: () => invoke<SaleRow[]>("get_sales"),
  getLogTail: (lines: number) => invoke<string[]>("get_log_tail", { lines }),
  getInstallers: () => invoke<InstallerInfo[]>("get_installers"),
  getConfig: () => invoke<BotConfig>("get_config"),
  setConfig: (config: BotConfig) => invoke<void>("set_config", { config }),
  generateTestKey: () => invoke<string>("generate_test_key"),
};
