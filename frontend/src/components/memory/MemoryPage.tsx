import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Check, FileText, LayoutGrid, Plus, Save, Trash2 } from 'lucide-react';
import { useMemoryStore, type MemoryEntry, type MemorySnapshot } from '@/store/memoryStore';
import { usePageExitGuard } from '@/hooks/usePageExitGuard';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { AlertStrip, EntryList, EntryRow, LoadingBlock, ManagementDialog, NothingHere, Tag } from '@/components/ui/ManagementDialog';
import { MemoryEditorPanel } from './MemoryEditorPanel';

interface MemoryPageProps {
  onClose: () => void;
}

type ViewMode = 'cards' | 'raw';

const MODE_OPTIONS: { id: ViewMode; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'cards', label: '卡片', icon: LayoutGrid },
  { id: 'raw', label: '整篇', icon: FileText },
];

/** 来源标签的色调：手动写入的用强调色，工具写入的用成功色，自动汇总的用中性色 */
const SOURCE_TONE: Record<MemoryEntry['source'], 'accent' | 'ok' | 'neutral'> = {
  AUTO: 'neutral',
  USER: 'accent',
  TOOL: 'ok',
};

/** size / maxSize 为字符数（与后端 MAX_MEMORY_SIZE 单位一致）。 */
const formatSize = (chars: number): string => `${chars.toLocaleString()} 字符`;

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

/** 内容自适应高度的 textarea：挂载与输入时按 scrollHeight 重算。模块级定义保证 ref 身份稳定。 */
const autoResize = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

/**
 * 浏览器刷新/关闭守卫桥：usePageExitGuard 无 enabled 参数、挂载即生效，
 * 故仅在 dirty 时条件挂载本组件（与 App 的 MobileKeyboardBridge 同一模式），
 * 有未保存修改时拦截浏览器刷新/关闭标签页。
 */
const DirtyPageExitGuard = () => {
  usePageExitGuard();
  return null;
};

export function MemoryPage({ onClose }: MemoryPageProps) {
  const {
    content, entries, updatedAt, size, maxSize,
    loading, saving, loaded, error, conflict,
    loadFile, saveRaw, saveEntries, setDirty,
  } = useMemoryStore();
  const [mode, setMode] = useState<ViewMode>('cards');
  const [editedEntries, setEditedEntries] = useState<MemoryEntry[]>(entries);
  const [rawContent, setRawContent] = useState(content);
  const [savedHint, setSavedHint] = useState(false);

  // 首次加载：替换 store 中的初始空值，未输入新草稿的编辑区随之同步
  useEffect(() => { void loadFile(); }, [loadFile]);

  // 每次用户输入都递增，包括改回旧内容；不能以内容是否等于旧基线判断有无编辑
  const editVersionRef = useRef(0);
  // 记录本地编辑态最后一次与服务端基线同步时的编辑版本
  const syncedEditVersionRef = useRef(0);
  // 保存/刷新请求序号，防止较早的响应重置较晚请求的状态
  const requestRevisionRef = useRef(0);
  // A retained draft keeps the version it was actually based on, even if a GET updates the store.
  const draftBaseRef = useRef(updatedAt);

  // 只有自上次基线同步后没有新编辑时才跟随服务端更新；
  // 有草稿（包括改回旧内容）时始终保留，覆盖关闭重开和迟到响应等路径
  useEffect(() => {
    if (editVersionRef.current === syncedEditVersionRef.current) {
      setEditedEntries(entries);
      setRawContent(content);
      draftBaseRef.current = updatedAt;
    }
  }, [entries, content, updatedAt]);

  // 仅在保存/刷新成功且请求版本仍有效时，显式采用服务端最新基线
  const resetToSaved = useCallback((snapshot: MemorySnapshot) => {
    syncedEditVersionRef.current = editVersionRef.current;
    draftBaseRef.current = snapshot.updatedAt;
    setEditedEntries(snapshot.entries);
    setRawContent(snapshot.content);
  }, []);

  // dirty 派生：当前模式的本地编辑态与已保存态的差异，同步进 store 供全局读取
  const cardsDirty = useMemo(
    () => JSON.stringify(editedEntries) !== JSON.stringify(entries),
    [editedEntries, entries],
  );
  const rawDirty = rawContent !== content;
  const dirtyNow = mode === 'cards' ? cardsDirty : rawDirty;
  useEffect(() => { setDirty(dirtyNow); }, [dirtyNow, entries, content, setDirty]);

  // 保存成功提示（2 秒自动消失）
  useEffect(() => {
    if (!savedHint) return;
    const timer = window.setTimeout(() => setSavedHint(false), 2000);
    return () => window.clearTimeout(timer);
  }, [savedHint]);

  const confirmDiscard = useCallback(
    () => !dirtyNow || window.confirm('有未保存的修改，确定要离开吗？'),
    [dirtyNow],
  );

  const switchMode = useCallback((next: ViewMode) => {
    // 保存进行中禁止切换：响应返回会按服务端结果重置编辑态，会覆盖切换后新输入的草稿
    if (saving || next === mode || !confirmDiscard()) return;
    // 丢弃本地未保存修改，回到已保存态
    syncedEditVersionRef.current = editVersionRef.current;
    draftBaseRef.current = updatedAt;
    setEditedEntries(entries);
    setRawContent(content);
    setMode(next);
  }, [saving, mode, confirmDiscard, entries, content, updatedAt]);

  const handleClose = useCallback(() => {
    if (confirmDiscard()) onClose();
  }, [confirmDiscard, onClose]);

  const handleRefresh = useCallback(() => {
    if (useMemoryStore.getState().saving) return;
    if ((dirtyNow || conflict) && !window.confirm('刷新会丢弃当前草稿并加载最新内容，请先复制需要保留的内容。继续吗？')) return;
    const editAtStart = editVersionRef.current;
    const requestId = ++requestRevisionRef.current;
    // 仅当请求成功、返回的仍是最后一次刷新、且期间没有新编辑时才重置草稿；
    // A failed or superseded GET returns no snapshot and must not reset the draft.
    void loadFile().then(snapshot => {
      if (!snapshot || requestId !== requestRevisionRef.current
          || editVersionRef.current !== editAtStart) return;
      resetToSaved(snapshot);
    });
  }, [dirtyNow, conflict, loadFile, resetToSaved]);

  const handleSave = useCallback(async () => {
    const editAtStart = editVersionRef.current;
    const requestId = ++requestRevisionRef.current;
    const snapshot = mode === 'cards'
      ? await saveEntries(editedEntries, draftBaseRef.current)
      : await saveRaw(rawContent, draftBaseRef.current);
    if (!snapshot || requestId !== requestRevisionRef.current) return;
    // Later edits in this mounted editor descend from our acknowledged write. Advance only
    // this draft's base; a newly mounted editor has separate refs and keeps its own version.
    draftBaseRef.current = snapshot.updatedAt;
    // 请求成功、仍是最后一次请求、且期间没有新编辑（含改回旧内容）才采用服务端规范化结果
    if (editVersionRef.current === editAtStart) {
      resetToSaved(snapshot);
      setSavedHint(true);
    }
  }, [mode, editedEntries, rawContent, saveEntries, saveRaw, resetToSaved]);

  const handleRawChange = useCallback((value: string) => {
    editVersionRef.current += 1;
    setRawContent(value);
  }, []);

  const updateEntry = useCallback((index: number, next: Partial<MemoryEntry>) => {
    editVersionRef.current += 1;
    setEditedEntries(prev => prev.map((entry, i) => (i === index ? { ...entry, ...next } : entry)));
  }, []);

  const removeEntry = useCallback((index: number) => {
    if (!window.confirm('确定删除这条记忆吗？')) return;
    editVersionRef.current += 1;
    setEditedEntries(prev => prev.filter((_, i) => i !== index));
  }, []);

  const addEntry = useCallback(() => {
    editVersionRef.current += 1;
    setEditedEntries(prev => [...prev, {
      source: 'USER',
      category: 'semantic',
      timestamp: new Date().toISOString(),
      content: '',
    }]);
  }, []);

  const usageRatio = maxSize > 0 ? size / maxSize : 0;
  const nearLimit = usageRatio > 0.8;
  const saveDisabled = saving || loading || conflict || !dirtyNow;
  const saveButton = (
    <Button
      size="sm"
      variant={dirtyNow && !conflict ? 'primary' : 'secondary'}
      onClick={() => void handleSave()}
      disabled={saveDisabled}
      loading={saving}
      aria-label="保存记忆"
    >
      <Save className="h-4 w-4" aria-hidden="true" />
      保存
    </Button>
  );

  return (
    <>
      {dirtyNow && <DirtyPageExitGuard />}
      <ManagementDialog
        icon={<Brain />}
        title="记忆"
        description="AI 会通过 Memory 工具写入，也可以在这里手动编辑；内容会在后续对话中自动加载。"
        onClose={handleClose}
        closeLabel="关闭记忆页面"
        actions={(
          <>
            {savedHint && (
              <span className="flex items-center gap-1 text-13 text-ok" role="status">
                <Check className="h-4 w-4" aria-hidden="true" />已保存
              </span>
            )}
            {saveButton}
          </>
        )}
        onRefresh={handleRefresh}
        refreshLabel="刷新记忆"
        refreshing={loading}
        refreshDisabled={saving}
        alerts={(
          <>
            {conflict && (
              <AlertStrip
                tone="warn"
                action={<Button size="sm" onClick={handleRefresh} disabled={loading || saving}>刷新</Button>}
              >
                内容已在别处修改，草稿已保留。请先复制需要保留的内容；刷新将丢弃草稿并加载最新内容。
              </AlertStrip>
            )}
            {error && <AlertStrip>加载或保存失败：{error}</AlertStrip>}
          </>
        )}
        toolbar={(
          <>
            <Tabs
              className="w-auto"
              aria-label="记忆视图模式"
              value={mode}
              onValueChange={value => switchMode(value as ViewMode)}
              items={MODE_OPTIONS.map(({ id, label, icon: Icon }) => ({
                value: id,
                label: <><Icon className="h-4 w-4" aria-hidden="true" />{label}</>,
              }))}
            />
            {mode === 'cards' && <span className="text-13 text-t3">{editedEntries.length} 条记忆</span>}
          </>
        )}
        footer={(
          <>
            <span className={nearLimit ? 'text-warnstrong dark:text-warn' : undefined}>
              文件大小 {formatSize(size)}{maxSize > 0 ? ` / ${formatSize(maxSize)}` : ''}
              {nearLimit && '（接近上限）'}
            </span>
            {updatedAt && <span className="max-md:hidden">更新于 {formatTime(updatedAt)}</span>}
          </>
        )}
      >
        {loading && !loaded ? (
          <LoadingBlock>正在读取记忆文件…</LoadingBlock>
        ) : mode === 'raw' ? (
          <div className="h-full">
            <MemoryEditorPanel content={rawContent} onChange={handleRawChange} fileName="MEMORY.md" dirty={rawDirty} />
          </div>
        ) : editedEntries.length === 0 ? (
          <NothingHere
            icon={<Brain />}
            title="暂无记忆"
            description="AI 可通过 Memory 工具写入，也可以在这里手动添加；内容会在后续对话中自动加载。"
            action={<Button size="sm" onClick={addEntry}><Plus className="h-4 w-4" aria-hidden="true" />新增条目</Button>}
          />
        ) : (
          <>
            <EntryList>
              {editedEntries.map((entry, index) => (
                <EntryRow
                  key={index}
                  badges={(
                    <>
                      <Tag tone={SOURCE_TONE[entry.source] ?? 'neutral'} className="font-mono">{entry.source}</Tag>
                      <Tag className="font-mono">{entry.category}</Tag>
                      <time className="text-13 text-t3" dateTime={entry.timestamp}>{formatTime(entry.timestamp)}</time>
                    </>
                  )}
                  actions={(
                    <Button size="sm" variant="ghost" onClick={() => removeEntry(index)} aria-label={`删除记忆条目 ${index + 1}`} title="删除">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  body={(
                    <textarea
                      ref={autoResize}
                      value={entry.content}
                      onChange={e => { updateEntry(index, { content: e.target.value }); autoResize(e.target); }}
                      rows={1}
                      className="w-full resize-none overflow-hidden rounded-sm border border-transparent bg-transparent p-2 text-13 leading-relaxed text-t1 outline-none focus:border-hairline focus:bg-surfacev2"
                      placeholder="记录一条记忆…"
                      aria-label={`记忆条目 ${index + 1} 内容`}
                    />
                  )}
                />
              ))}
            </EntryList>
            <button
              type="button"
              onClick={addEntry}
              className="dialog-control mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-dashed border-hairline py-2.5 text-13 text-t2 hover:bg-hover2 hover:text-t1 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />新增条目
            </button>
          </>
        )}
      </ManagementDialog>
    </>
  );
}

export default MemoryPage;
