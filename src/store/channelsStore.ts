import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Bot } from "@/types/bot";
import type { Channel } from "@/types/channel";

interface ChannelsState {
  bots: Bot[];
  channels: Channel[];
  activeBot: string | null;
  activeChannel: string | null;

  setBots: (bots: Bot[]) => void;
  addBot: (bot: Bot) => void;
  removeBot: (id: string) => void;

  setChannels: (channels: Channel[]) => void;
  addChannel: (channel: Channel) => void;
  removeChannel: (id: string) => void;
  updateChannelBot: (channelId: string, botId: string) => void;

  setActiveBot: (id: string | null) => void;
  setActiveChannel: (id: string | null) => void;
}

// Some DB rows can end up pointing at the same Telegram channel (e.g. added
// via two different bots) — keep only the first occurrence for display.
export function dedupeChannels(channels: Channel[]): Channel[] {
  const seen = new Set<string>();
  return channels.filter((c) =>
    seen.has(c.telegramId) ? false : !!seen.add(c.telegramId)
  );
}

export const useChannelsStore = create<ChannelsState>()(
  persist(
    (set) => ({
      bots:          [],
      channels:      [],
      activeBot:     null,
      activeChannel: null,

      setBots:    (bots)     => set({ bots }),
      addBot:     (bot)      => set((s) => ({ bots: [...s.bots, bot] })),
      removeBot:  (id)       =>
        set((s) => ({ bots: s.bots.filter((b) => b.id !== id) })),

      setChannels:   (channels) => set({ channels }),
      addChannel:    (channel)  =>
        set((s) => ({
          channels: s.channels.some((c) => c.telegramId === channel.telegramId)
            ? s.channels
            : [...s.channels, channel],
        })),
      removeChannel: (id)       =>
        set((s) => ({ channels: s.channels.filter((c) => c.id !== id) })),
      updateChannelBot: (channelId, botId) =>
        set((s) => ({
          channels: s.channels.map((c) =>
            c.id === channelId ? { ...c, botId } : c
          ),
        })),

      setActiveBot:     (id) => set({ activeBot: id }),
      setActiveChannel: (id) => set({ activeChannel: id }),
    }),
    { name: "ts-channels" }
  )
);
