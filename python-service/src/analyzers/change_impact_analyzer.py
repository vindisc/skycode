"""
变更影响分析器 — F33 Change Impact Analysis

基于调用图的 BFS 影响传播分析：
- 定位修改行所在的函数/方法/类
- BFS 遍历调用图，按层标注 direct / indirect / potential
- 生成影响摘要（受影响 API、定时任务等）
- 60s 超时保护，超时返回部分结果
"""

import asyncio
import hashlib
import logging
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Set, Tuple

import networkx as nx
from pydantic import BaseModel

from .call_graph_builder import CallGraphBuilder

logger = logging.getLogger(__name__)

# ── 分析超时 (秒) ──
_ANALYSIS_TIMEOUT = 60

# ── 调用图缓存 ──
# 整个条目是一个元组，整体替换（先前的「逐字段写 dict」在超时线程与并发请求交错时
# 会写出 key 与 graph 不匹配的脏缓存）。读 / 写都在锁内做快照。
# 注意：asyncio.wait_for 超时并不会取消已在线程池里跑的构建，它会继续跑完并写回
# 缓存——元组整体替换保证写回的 key/graph/builder 永远自洽。
_graph_cache: Optional[Tuple[str, nx.DiGraph, CallGraphBuilder, float]] = None
_graph_cache_lock = threading.Lock()
_CACHE_TTL = 300  # 5 minutes


# ═══════════════════════════════════════════════════════════════
# Pydantic 响应模型
# ═══════════════════════════════════════════════════════════════

class ChangeImpactNode(BaseModel):
    """影响链路中的节点"""
    id: str
    type: Literal["api", "service", "repository", "scheduler", "config", "function", "class"]
    name: str
    file_path: str
    line_range: List[int]           # [start, end]
    impact_level: Literal["direct", "indirect", "potential"]
    confidence: Literal["high", "medium", "low"]
    language: Optional[str] = None


class ChangeImpactEdge(BaseModel):
    """影响链路中的边"""
    source: str
    target: str
    type: Literal["call", "dependency", "data-flow"]
    weight: float = 1.0


class ChangeImpactSummary(BaseModel):
    """影响摘要"""
    direct_count: int
    indirect_count: int
    potential_count: int
    affected_apis: List[str]
    affected_tasks: List[str]
    confidence_breakdown: Dict[str, int] = {}  # {"high": N, "medium": N, "low": N}


class ChangeImpactResult(BaseModel):
    """变更影响分析结果"""
    changed_file: str
    changed_lines: List[int]
    impact_nodes: List[ChangeImpactNode]
    impact_edges: List[ChangeImpactEdge]
    summary: ChangeImpactSummary
    truncated: bool = False          # 是否因超时截断
    graph_stats: Dict[str, int] = {}  # {"total_nodes": N, "total_edges": N}


# ═══════════════════════════════════════════════════════════════
# ChangeImpactAnalyzer
# ═══════════════════════════════════════════════════════════════

class ChangeImpactAnalyzer:
    """变更影响分析器 — 基于调用图的 BFS 传播"""

    def __init__(self):
        self._call_graph_builder = CallGraphBuilder()

    async def analyze(
        self,
        file_path: str,
        changed_lines: List[int],
        project_root: str,
        depth: int = 3,
    ) -> ChangeImpactResult:
        """
        分析代码变更的影响链路。

        Args:
            file_path: 被修改的文件路径
            changed_lines: 修改的行号列表
            project_root: 项目根目录
            depth: BFS 最大深度 (1|3|5)

        Returns:
            ChangeImpactResult 包含影响节点、边和摘要
        """
        start_time = time.monotonic()
        truncated = False

        try:
            # 在线程池中执行 CPU 密集型分析（带超时）
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    self._analyze_sync, file_path, changed_lines, project_root, depth
                ),
                timeout=_ANALYSIS_TIMEOUT,
            )
            return result
        except asyncio.TimeoutError:
            logger.warning(
                "Change impact analysis timed out after %ds for %s",
                _ANALYSIS_TIMEOUT, file_path,
            )
            # 超时：返回空结果
            return ChangeImpactResult(
                changed_file=file_path,
                changed_lines=changed_lines,
                impact_nodes=[],
                impact_edges=[],
                summary=ChangeImpactSummary(
                    direct_count=0, indirect_count=0, potential_count=0,
                    affected_apis=[], affected_tasks=[],
                ),
                truncated=True,
                graph_stats={},
            )

    def _analyze_sync(
        self,
        file_path: str,
        changed_lines: List[int],
        project_root: str,
        depth: int,
    ) -> ChangeImpactResult:
        """同步分析（在线程池中执行）"""

        # 1. 构建或获取缓存的调用图
        graph, builder = self._get_or_build_graph(project_root)

        graph_stats = {
            "total_nodes": graph.number_of_nodes(),
            "total_edges": graph.number_of_edges(),
        }

        # 2. 定位修改的函数/方法/类
        modified_elements = self._locate_modified_elements(
            file_path, changed_lines, graph
        )

        if not modified_elements:
            logger.info("No graph nodes found for modified lines in %s", file_path)
            return ChangeImpactResult(
                changed_file=file_path,
                changed_lines=changed_lines,
                impact_nodes=[],
                impact_edges=[],
                summary=ChangeImpactSummary(
                    direct_count=0, indirect_count=0, potential_count=0,
                    affected_apis=[], affected_tasks=[],
                ),
                graph_stats=graph_stats,
            )

        # 3. BFS 遍历影响链路
        impact_nodes, impact_edges = self._bfs_impact(
            graph, modified_elements, depth
        )

        # 4. 生成摘要
        summary = self._generate_summary(impact_nodes)

        return ChangeImpactResult(
            changed_file=file_path,
            changed_lines=changed_lines,
            impact_nodes=impact_nodes,
            impact_edges=impact_edges,
            summary=summary,
            graph_stats=graph_stats,
        )

    # ── 调用图缓存 ────────────────────────────────────────

    def _get_or_build_graph(
        self, project_root: str
    ) -> Tuple[nx.DiGraph, CallGraphBuilder]:
        """获取缓存的调用图或重建"""
        global _graph_cache

        cache_key = self._compute_cache_key(project_root)

        with _graph_cache_lock:
            cached = _graph_cache
        if (
            cached is not None
            and cached[0] == cache_key
            and (time.time() - cached[3]) < _CACHE_TTL
        ):
            logger.debug("Using cached call graph for %s", project_root)
            return cached[1], cached[2]

        logger.info("Building call graph for %s", project_root)
        builder = CallGraphBuilder()
        graph = builder.build(project_root)
        if builder.truncated:
            logger.warning(
                "Call graph for %s was truncated by build budget; "
                "impact results may be partial", project_root,
            )

        with _graph_cache_lock:
            _graph_cache = (cache_key, graph, builder, time.time())

        logger.info(
            "Call graph built: %d nodes, %d edges",
            graph.number_of_nodes(), graph.number_of_edges(),
        )
        return graph, builder

    @staticmethod
    def _compute_cache_key(project_root: str) -> str:
        """基于项目根路径 + 源文件最新修改时间计算缓存 key。

        纯 stat 遍历（不解析内容），数千文件量级在百毫秒内；
        覆盖全树而不是采样，改动任何文件都能让下一次请求重建图。
        """
        root = Path(project_root)
        max_mtime = 0.0
        try:
            for p in root.rglob("*"):
                if (not p.is_symlink() and p.is_file()
                        and p.suffix in (".py", ".java", ".ts", ".tsx")):
                    mtime = p.stat().st_mtime
                    if mtime > max_mtime:
                        max_mtime = mtime
        except OSError:
            pass
        raw = f"{project_root}:{max_mtime}"
        return hashlib.md5(raw.encode()).hexdigest()

    # ── 定位修改元素 ──────────────────────────────────────

    def _locate_modified_elements(
        self, file_path: str, changed_lines: List[int], graph: nx.DiGraph
    ) -> List[str]:
        """定位修改行所在的函数/方法/类"""
        matched: List[str] = []
        changed_set = set(changed_lines)

        # 规范化 file_path 用于匹配
        norm_path = str(Path(file_path))

        for node_id, attrs in graph.nodes(data=True):
            node_file = attrs.get("file_path", "")
            # 路径匹配：完全匹配或结尾匹配
            if not (node_file == norm_path or norm_path.endswith(node_file)
                    or node_file.endswith(norm_path)):
                continue

            line_range = attrs.get("line_range", [0, 0])
            if len(line_range) == 2:
                start, end = line_range
                # 检查修改行是否落在该节点范围内
                if any(start <= line <= end for line in changed_set):
                    matched.append(node_id)

        return matched

    # ── BFS 影响传播 ──────────────────────────────────────

    def _bfs_impact(
        self,
        graph: nx.DiGraph,
        start_nodes: List[str],
        max_depth: int,
    ) -> Tuple[List[ChangeImpactNode], List[ChangeImpactEdge]]:
        """
        BFS 遍历影响传播。

        impact_level 规则：
          - depth 1: direct (直接调用者)
          - depth 2-3: indirect (间接影响)
          - depth 4+: potential (潜在影响)
        """
        visited: Set[str] = set(start_nodes)
        queue: deque = deque()  # (node_id, depth)
        impact_nodes: List[ChangeImpactNode] = []
        impact_edges: List[ChangeImpactEdge] = []

        # 先把起始节点加入结果 (作为 direct)
        for nid in start_nodes:
            attrs = graph.nodes.get(nid, {})
            impact_nodes.append(ChangeImpactNode(
                id=nid,
                type=attrs.get("type", "function"),
                name=attrs.get("name", nid.split(".")[-1]),
                file_path=attrs.get("file_path", ""),
                line_range=attrs.get("line_range", [0, 0]),
                impact_level="direct",
                confidence=attrs.get("confidence", "medium"),
                language=attrs.get("language"),
            ))
            # 入队：所有 caller (被哪些节点调用) — 反向传播
            for predecessor in graph.predecessors(nid):
                if predecessor not in visited:
                    queue.append((predecessor, 1))
                    visited.add(predecessor)
                    edge_data = graph.edges.get((predecessor, nid), {})
                    impact_edges.append(ChangeImpactEdge(
                        source=predecessor,
                        target=nid,
                        type=edge_data.get("type", "call"),
                        weight=edge_data.get("weight", 1.0),
                    ))
            # 也检查正向依赖（被该节点调用的）
            for successor in graph.successors(nid):
                if successor not in visited:
                    queue.append((successor, 1))
                    visited.add(successor)
                    edge_data = graph.edges.get((nid, successor), {})
                    impact_edges.append(ChangeImpactEdge(
                        source=nid,
                        target=successor,
                        type=edge_data.get("type", "call"),
                        weight=edge_data.get("weight", 1.0),
                    ))

        # BFS 遍历
        while queue:
            current_id, current_depth = queue.popleft()

            if current_depth > max_depth:
                continue

            attrs = graph.nodes.get(current_id, {})
            impact_level = self._depth_to_level(current_depth)

            impact_nodes.append(ChangeImpactNode(
                id=current_id,
                type=attrs.get("type", "function"),
                name=attrs.get("name", current_id.split(".")[-1]),
                file_path=attrs.get("file_path", ""),
                line_range=attrs.get("line_range", [0, 0]),
                impact_level=impact_level,
                confidence=attrs.get("confidence", "medium"),
                language=attrs.get("language"),
            ))

            # 继续向上游传播（谁调用了当前节点）
            if current_depth < max_depth:
                for predecessor in graph.predecessors(current_id):
                    if predecessor not in visited:
                        visited.add(predecessor)
                        queue.append((predecessor, current_depth + 1))
                        edge_data = graph.edges.get((predecessor, current_id), {})
                        impact_edges.append(ChangeImpactEdge(
                            source=predecessor,
                            target=current_id,
                            type=edge_data.get("type", "call"),
                            weight=edge_data.get("weight", 1.0),
                        ))

        return impact_nodes, impact_edges

    @staticmethod
    def _depth_to_level(depth: int) -> Literal["direct", "indirect", "potential"]:
        """BFS 深度 → 影响级别"""
        if depth <= 1:
            return "direct"
        elif depth <= 3:
            return "indirect"
        else:
            return "potential"

    # ── 摘要生成 ──────────────────────────────────────────

    @staticmethod
    def _generate_summary(impact_nodes: List[ChangeImpactNode]) -> ChangeImpactSummary:
        """生成影响摘要"""
        direct_count = 0
        indirect_count = 0
        potential_count = 0
        affected_apis: List[str] = []
        affected_tasks: List[str] = []
        confidence_map: Dict[str, int] = {"high": 0, "medium": 0, "low": 0}

        for node in impact_nodes:
            if node.impact_level == "direct":
                direct_count += 1
            elif node.impact_level == "indirect":
                indirect_count += 1
            else:
                potential_count += 1

            if node.type == "api":
                affected_apis.append(node.name)
            elif node.type == "scheduler":
                affected_tasks.append(node.name)

            confidence_map[node.confidence] = confidence_map.get(node.confidence, 0) + 1

        return ChangeImpactSummary(
            direct_count=direct_count,
            indirect_count=indirect_count,
            potential_count=potential_count,
            affected_apis=affected_apis,
            affected_tasks=affected_tasks,
            confidence_breakdown=confidence_map,
        )
