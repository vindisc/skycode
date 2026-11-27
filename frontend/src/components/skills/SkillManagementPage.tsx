import { useEffect, useId, useMemo, useState } from 'react';
import { Puzzle } from 'lucide-react';
import { isSkillDetail, useSkillStore, type SkillDetail, type SkillItem } from '@/store/skillStore';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import {
  AlertStrip, EntryList, EntryRow, EntryToggle, LoadingBlock, ManagementDialog, NothingHere, SearchField, Tag, ToolbarStats,
} from '@/components/ui/ManagementDialog';

const SOURCE_LABELS: Record<string, string> = {
  BUNDLED: '内置',
  MANAGED: '管理配置',
  USER: '用户',
  PROJECT: '项目',
  PLUGIN: '插件',
  MCP: 'MCP',
};

export function SkillManagementPage({ onClose }: { onClose: () => void }) {
  const { skills, loaded, loading, error, stateError, pending, loadSkills, toggleSkill } = useSkillStore();
  const [query, setQuery] = useState('');
  const [detailVersion, setDetailVersion] = useState(0);

  useEffect(() => { void loadSkills(); }, [loadSkills]);

  const visibleSkills = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return skills;
    return skills.filter(skill => [skill.name, skill.id, skill.description, skill.source, SOURCE_LABELS[skill.source]]
      .some(value => value?.toLowerCase().includes(keyword)));
  }, [skills, query]);
  const enabledCount = skills.filter(skill => skill.enabled).length;

  const refresh = async () => {
    await loadSkills();
    setDetailVersion(version => version + 1);
  };

  return (
    <ManagementDialog
      icon={<Puzzle />}
      title="Skill 管理"
      description="关闭后立即阻止新的技能调用，下一条消息按更新后的配置执行，无需重启。"
      onClose={onClose}
      closeLabel="关闭 Skill 管理"
      onRefresh={() => void refresh()}
      refreshLabel="刷新 Skill 列表"
      refreshing={loading}
      alerts={(
        <>
          {error && <AlertStrip>加载或更新失败：{error}</AlertStrip>}
          {stateError && <AlertStrip>技能设置暂不可用：{stateError} 所有技能已关闭，暂时无法修改开关。修复设置并重启服务后请刷新。</AlertStrip>}
        </>
      )}
      toolbar={(
        <>
          <ToolbarStats note="设置保存在服务端，所有设备和会话共享；历史中的技能内容仍可能影响当前回答，新聊天不受影响。">
            <span>{skills.length} 个 Skill</span>
            <span className="text-ok">{enabledCount} 个已启用</span>
          </ToolbarStats>
          <SearchField value={query} onChange={setQuery} label="搜索 Skill" placeholder="搜索名称、描述或来源" />
        </>
      )}
    >
      {loading && !loaded ? (
        <LoadingBlock>正在读取 Skill 配置…</LoadingBlock>
      ) : visibleSkills.length === 0 ? (
        <NothingHere
          icon={<Puzzle />}
          title={query.trim() ? '没有匹配的 Skill' : error ? '暂时无法读取 Skill，请重试。' : '暂无可管理的 Skill'}
          description={query.trim() ? '换个关键词，或清空搜索。' : undefined}
        />
      ) : (
        <EntryList>
          {visibleSkills.map(skill => (
            <SkillRow key={skill.id} skill={skill} busy={pending[skill.id] === true} blocked={stateError !== null} detailVersion={detailVersion} onToggle={() => void toggleSkill(skill.id, !skill.enabled)} />
          ))}
        </EntryList>
      )}
    </ManagementDialog>
  );
}

function SkillRow({ skill, busy, blocked, detailVersion, onToggle }: {
  skill: SkillItem;
  busy: boolean;
  blocked: boolean;
  detailVersion: number;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const detailId = useId();

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/skills/manage/${encodeURIComponent(skill.id)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const detail: unknown = await response.json();
        if (!isSkillDetail(detail) || detail.id !== skill.id) throw new Error('技能详情格式无效');
        return detail;
      })
      .then(value => { if (!controller.signal.aborted) setDetail(value); })
      .catch(failure => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [expanded, skill.id, detailVersion, retry]);

  return (
    <EntryRow
      title={skill.name}
      badges={<Tag>{SOURCE_LABELS[skill.source] ?? skill.source}</Tag>}
      description={skill.description}
      actions={(
        <EntryToggle
          checked={skill.enabled}
          onCheckedChange={onToggle}
          disabled={busy || blocked}
          label={`${skill.enabled ? '关闭' : '启用'} ${skill.name}`}
        />
      )}
      expand={{
        expanded,
        onToggle: () => setExpanded(value => !value),
        label: `${expanded ? '收起' : '展开'} ${skill.name} 详情`,
        controls: detailId,
      }}
    >
      {loading ? (
        <p className="flex items-center gap-2"><Spinner size="sm" label="正在读取详情" />正在读取详情…</p>
      ) : error ? (
        <div>
          <p role="alert" className="break-words text-err [overflow-wrap:anywhere]">读取详情失败：{error}</p>
          <Button size="sm" className="mt-2" onClick={() => setRetry(value => value + 1)}>重试读取详情</Button>
        </div>
      ) : detail && (
        <div className="space-y-2">
          <p className="break-words leading-relaxed [overflow-wrap:anywhere]">{skill.description}</p>
          <p className="break-all"><span className="font-medium text-t1">文件：</span>{detail.filePath || '内置 Skill'}</p>
          <pre tabIndex={0} aria-label={`${skill.name} 的技能正文`} className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-sm bg-sunken2 p-3 font-mono leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring [overflow-wrap:anywhere]">{detail.content || '暂无内容'}</pre>
        </div>
      )}
    </EntryRow>
  );
}
