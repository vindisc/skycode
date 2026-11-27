import { useEffect, useId, useMemo, useState } from 'react';
import { Cable } from 'lucide-react';
import { useMcpServiceStore, type McpService } from '@/store/mcpServiceStore';
import {
  AlertStrip, EntryList, EntryRow, EntryToggle, LoadingBlock, ManagementDialog, NothingHere, SearchField, Tag, ToolbarStats,
} from '@/components/ui/ManagementDialog';

interface McpManagementPageProps {
  onClose: () => void;
}

const DOMAIN_LABELS: Record<string, string> = {
  configured: '已配置',
  web_search: '网络搜索',
  news: '新闻',
  legal_research: '法律',
  company_intelligence: '企业信息',
  content_safety: '内容安全',
  map_navigation: '地图',
  image_processing: '图像',
  video_generation: '视频',
  financial_research: '金融',
  academic_research: '学术',
  product_sourcing: '采购',
  logistics: '物流',
  commodity_market: '行情',
  retail_insights: '零售',
  tourism_insights: '旅游',
};

const STATUS_LABELS: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中',
  disabled: '未启用',
  not_connected: '待连接',
  needs_auth: '缺少密钥',
  missing_endpoint: '缺少地址',
  failed: '连接失败',
};

export function McpManagementPage({ onClose }: McpManagementPageProps) {
  const { services, loading, error, total, enabledCount, pending, loadServices, toggleService } =
    useMcpServiceStore();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => { void loadServices(); }, [loadServices]);

  const visibleServices = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return services;
    return services.filter(service =>
      [service.displayName, service.serverKey, service.description, service.domain,
        ...service.tools.flatMap(tool => [tool.name, tool.toolName])]
        .some(value => value?.toLowerCase().includes(keyword)),
    );
  }, [query, services]);

  const searching = query.trim().length > 0;

  return (
    <ManagementDialog
      icon={<Cable />}
      title="MCP 管理"
      description="决定哪些服务向模型开放工具；低频或高风险的服务默认关闭。"
      onClose={onClose}
      closeLabel="关闭 MCP 管理"
      onRefresh={() => void loadServices()}
      refreshLabel="刷新 MCP 服务"
      refreshing={loading}
      alerts={error && <AlertStrip>加载或更新失败：{error}</AlertStrip>}
      toolbar={(
        <>
          <ToolbarStats note="状态保存在本机">
            <span>{total} 个服务</span>
            <span className="text-ok">{enabledCount} 个已启用</span>
          </ToolbarStats>
          <SearchField value={query} onChange={setQuery} label="搜索 MCP 服务" placeholder="搜索服务或工具" />
        </>
      )}
    >
      {loading && services.length === 0 ? (
        <LoadingBlock>正在读取 MCP 配置…</LoadingBlock>
      ) : visibleServices.length === 0 ? (
        <NothingHere
          icon={<Cable />}
          title={searching ? '没有匹配的 MCP 服务' : '暂无可管理的 MCP 服务'}
          description={searching ? '换个关键词，或清空搜索。' : undefined}
        />
      ) : (
        <EntryList>
          {visibleServices.map(service => (
            <ServiceRow
              key={service.serverKey}
              service={service}
              busy={Boolean(pending[service.serverKey])}
              expanded={Boolean(expanded[service.serverKey])}
              onExpand={() => setExpanded(current => ({ ...current, [service.serverKey]: !current[service.serverKey] }))}
              onToggle={() => void toggleService(service.serverKey, !service.enabled)}
            />
          ))}
        </EntryList>
      )}
    </ManagementDialog>
  );
}

function ServiceRow({ service, busy, expanded, onExpand, onToggle }: {
  service: McpService;
  busy: boolean;
  expanded: boolean;
  onExpand: () => void;
  onToggle: () => void;
}) {
  const detailId = useId();
  // 开关关着时不必再标「未启用」；开着时只把连不上、缺密钥这类异常标成警告色
  const needsAttention = ['failed', 'needs_auth', 'missing_endpoint'].includes(service.status);
  const status = !service.enabled ? null : (
    <Tag tone={service.status === 'connected' ? 'ok' : needsAttention ? 'warn' : 'neutral'}>
      {STATUS_LABELS[service.status] ?? service.status}
    </Tag>
  );
  const toolSummary = service.source === 'registry'
    ? `${service.toolCount} 个白名单工具`
    : service.toolCount > 0 ? `${service.toolCount} 个已发现工具` : '工具将在连接后发现';

  return (
    <EntryRow
      title={service.displayName}
      badges={<><Tag>{DOMAIN_LABELS[service.domain] ?? service.domain}</Tag>{status}</>}
      description={service.description}
      meta={<>{toolSummary}<span aria-hidden="true"> · </span><span className="font-mono">{service.transportType}</span></>}
      actions={(
        <EntryToggle
          checked={service.enabled}
          onCheckedChange={onToggle}
          disabled={busy}
          label={`${service.enabled ? '停用' : '启用'} ${service.displayName}`}
        />
      )}
      expand={{
        expanded,
        onToggle: onExpand,
        label: `${expanded ? '收起' : '展开'} ${service.displayName} 工具`,
        disabled: service.tools.length === 0,
        controls: detailId,
      }}
    >
      <ul className="space-y-1.5">
        {service.tools.map(tool => (
          <li key={tool.id} className="flex items-start justify-between gap-3">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {tool.name}
              <span className="ml-2 font-mono text-t3">{tool.toolName}</span>
            </span>
            {!tool.allowlisted && <Tag tone="warn" className="shrink-0">未授权</Tag>}
          </li>
        ))}
      </ul>
    </EntryRow>
  );
}
