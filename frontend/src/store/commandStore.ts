/**
 * commandStore — 命令列表存储
 * SPEC: §4.4 命令自动补全
 */

import { create } from 'zustand';
import type { CommandItem } from '@/utils/fuzzyMatch';

export interface CommandStoreState {
    commands: CommandItem[];
    loaded: boolean;
    loadCommands: () => Promise<void>;
}

export const useCommandStore = create<CommandStoreState>((set) => ({
    commands: [],
    loaded: false,
    loadCommands: async () => {
        try {
            const res = await fetch('/api/commands');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: unknown = await res.json();
            // 只收下形状正确的条目，避免坏数据污染命令清单与提交路由白名单
            const commands = (Array.isArray(data) ? data : []).filter((item): item is CommandItem =>
                typeof item?.name === 'string' && item.name.trim() !== ''
                && typeof item?.description === 'string');
            set({ commands, loaded: true });
        } catch (err) {
            console.error('Failed to load commands:', err);
        }
    },
}));
