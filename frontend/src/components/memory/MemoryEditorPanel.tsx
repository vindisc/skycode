import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Eye, Edit3, FileText, Plus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import { Button } from '@/components/ui/Button';

/**
 * MemoryEditorPanel — 整篇 Markdown 编辑器（受控组件）。
 *
 * 仅负责编辑/预览/模板插入；保存由外层页面统一触发（记忆弹窗头部的保存按钮）。
 * 版式与 EntryList 的卡片一致：一张带描边的卡，顶部一行工具，下面是编辑区。
 */

interface MemoryEditorPanelProps {
    content: string;
    onChange: (value: string) => void;
    fileName?: string;
    dirty?: boolean;
}

const MEMORY_TEMPLATES: Record<string, string> = {
    '技术栈': '## 技术栈\n- 后端: \n- 前端: \n- 数据库: \n',
    '编码规范': '## 编码规范\n- \n',
    '常见问题': '## 常见问题\n- \n',
    '注意事项': '## 注意事项\n- \n',
};

export const MemoryEditorPanel: React.FC<MemoryEditorPanelProps> = ({
    content, onChange, fileName = 'memory.md', dirty = false,
}) => {
    const [isPreview, setIsPreview] = useState(false);
    const [showTemplateMenu, setShowTemplateMenu] = useState(false);
    const templateRef = useRef<HTMLDivElement>(null);

    const insertTemplate = useCallback((template: string) => {
        onChange(content + '\n\n' + template);
    }, [content, onChange]);

    // 点到菜单外面收起模板菜单
    useEffect(() => {
        if (!showTemplateMenu) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!templateRef.current?.contains(event.target as Node)) setShowTemplateMenu(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [showTemplateMenu]);

    return (
        <div className="flex h-full flex-col overflow-hidden rounded-md border border-hairline bg-surface2">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-t3" aria-hidden="true" />
                    <span className="truncate font-mono text-13 text-t2">{fileName}</span>
                    {dirty && <span className="shrink-0 text-13 text-warn">● 未保存</span>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <div className="relative" ref={templateRef}>
                        <Button size="sm" variant="ghost" onClick={() => setShowTemplateMenu(value => !value)} title="插入模板" aria-label="插入模板">
                            <Plus className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {showTemplateMenu && (
                            <div className="absolute right-0 top-full z-10 mt-1 min-w-[140px] overflow-hidden rounded-sm border border-hairline bg-surfacev2 py-1 shadow-e3">
                                {Object.entries(MEMORY_TEMPLATES).map(([name, tpl]) => (
                                    <button
                                        key={name}
                                        type="button"
                                        onClick={() => { insertTemplate(tpl); setShowTemplateMenu(false); }}
                                        className="dialog-control flex w-full items-center px-3 py-1.5 text-left text-13 text-t1 hover:bg-hover2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring"
                                    >
                                        {name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIsPreview(value => !value)}
                        title={isPreview ? '编辑模式' : '预览模式'}
                        aria-label={isPreview ? '切换到编辑模式' : '切换到预览模式'}
                    >
                        {isPreview ? <Edit3 className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </Button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                {isPreview ? (
                    <div className="prose prose-sm max-w-none p-4 dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{DOMPurify.sanitize(content)}</ReactMarkdown>
                    </div>
                ) : (
                    <textarea
                        value={content}
                        onChange={e => onChange(e.target.value)}
                        className="h-full w-full resize-none bg-transparent p-4 font-mono text-13 leading-relaxed text-t1 outline-none"
                        placeholder="# 项目记忆&#10;&#10;在此输入项目记忆内容..."
                        spellCheck={false}
                        aria-label="记忆文件内容"
                    />
                )}
            </div>
        </div>
    );
};
