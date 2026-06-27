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

  setActiveBot: (id: string | null) => void;
  setActiveChannel: (id: string | null) => void;
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

      setActiveBot:     (id) => set({ activeBot: id }),
      setActiveChannel: (id) => set({ activeChannel: id }),
    }),
    { name: "ts-channels" }
  )
);
