/**
 * FileAutoComplete — 文件自动补全下拉组件
 * SPEC: §4.3 @文件附件功能
 */

import React, { useState, useEffect, useRef } from 'react';
import { Folder, File } from 'lucide-react';
import { useSessionStore } from '@/store/sessionStore';

interface FileResult {
    path: string;
    name: string;
    type: 'file' | 'directory';
    score: number;
}

interface FileAutoCompleteProps {
    query: string;
    onSelect: (filePath: string) => void;
    onClose: () => void;
}

export const FileAutoComplete: React.FC<FileAutoCompleteProps> = ({
    query, onSelect, onClose,
}) => {
    const [results, setResults] = useState<FileResult[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();
    const sessionId = useSessionStore(s => s.sessionId);

    // 防抖搜索
    useEffect(() => {
        if (!query || !sessionId) {
            setResults([]);
            return;
        }
        clearTimeout(debounceRef.current);
        const controller = new AbortController();
        let active = true;
        debounceRef.current = setTimeout(async () => {
            setLoading(true);
            try {
                const params = new URLSearchParams({
                    query,
                    limit: '15',
                    sessionId,
                });
                const res = await fetch(
                    `/api/files/search?${params}`,
                    { signal: controller.signal },
                );
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = await res.json() as unknown;
                if (!Array.isArray(data)
                        || !data.every(item =>
                            item !== null
                            && typeof item === 'object'
                            && typeof item.path === 'string'
                            && typeof item.name === 'string'
                            && (item.type === 'file'
                                || item.type === 'directory')
                            && typeof item.score === 'number')) {
                    throw new Error(
                        'Invalid file search response');
                }
                if (!active) return;
                setResults(data as FileResult[]);
                setSelectedIndex(0);
            } catch {
                if (active) setResults([]);
            } finally {
                if (active) setLoading(false);
            }
        }, 150);
        return () => {
            active = false;
            clearTimeout(debounceRef.current);
            controller.abort();
        };
    }, [query, sessionId]);

    // 键盘导航
    useEffect(() => {
        // 下拉未渲染（无结果且不在加载中）时不挂监听，避免 ArrowUp/Down/Tab/Escape 被
        // preventDefault 吞掉导致 Tab 无法移出焦点（渲染 null 的条件与此保持一致）
        if (results.length === 0 && !loading) return;
        const handler = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowDown': e.preventDefault();
                    setSelectedIndex(i => Math.min(i + 1, results.length - 1)); break;
                case 'ArrowUp': e.preventDefault();
                    setSelectedIndex(i => Math.max(i - 1, 0)); break;
                case 'Enter': case 'Tab': e.preventDefault();
                    if (results[selectedIndex]) onSelect(results[selectedIndex].path); break;
                case 'Escape': onClose(); break;
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [results, selectedIndex, onSelect, onClose, loading]);

    if (!results.length && !loading) return null;

    return (
        <div className="absolute bottom-full mb-1 left-0 z-50 bg-surfacev2
            border rounded-sm shadow-e4 max-h-64 overflow-y-auto w-80">
            {loading && <div className="p-2 text-13 text-t2">搜索中...</div>}
            {results.map((r, i) => (
                <button key={r.path}
                    className={`panel-control w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm
                        ${i === selectedIndex ? 'bg-accent2-strong text-white' : 'hover:bg-hover2'}`}
                    onClick={() => onSelect(r.path)}
                    onMouseEnter={() => setSelectedIndex(i)}>
                    <span>{r.type === 'directory'
                        ? <Folder aria-hidden="true" className="h-4 w-4 shrink-0" />
                        : <File aria-hidden="true" className="h-4 w-4 shrink-0" />}</span>
                    <span className="flex-1 font-mono truncate">{r.path}</span>
                </button>
            ))}
        </div>
    );
};
