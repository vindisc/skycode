#!/bin/bash
# test-smoke.sh — L0 冒烟验证：小改动的一分钟默认门。
#
# 测试分层约定（2026-11-28）：
#   L0 冒烟（本脚本）  任何后端小改动的默认验证。后端 @Tag("smoke") 的 22 个核心类
#                      （模型注册/场景分派/提示注入/记忆/WS 状态/控制器校验等）
#                      + 前端 src/api src/store + pytest 全量。约 1 分钟。
#   L1 模块            改哪跑哪：后端 `./mvnw test "-Dtest=com.aicodeassistant.<包>.*"`；
#                      前端 `npx vitest run <改动文件的测试路径>`。
#   L2 全量            推送前 / 大改动 / 部署镜像前：`./mvnw test` + `vitest run` 全量
#                      （CI 的 ci.yml 在 push/PR 上永远全量）。
# 安全注意事项：
#   - 改动 Spring Bean 的构造器/新增 Bean 后，必须额外跑 SecurityFilterIntegrationTest
#     （拉完整上下文，是唯一能抓 Bean 装配致命错误的用例）——它不在 smoke 集，很慢。
#   - Docker 构建里的 npm run build 连测试一起做类型检查：改测试也要 `npx tsc --noEmit`。
#
# 用法: ./scripts/test-smoke.sh [--backend-only|--frontend-only]
# 退出码: 任意层失败返回 1（失败层仍会跑完其他层，汇总看全貌）。

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_ONLY=0
FRONTEND_ONLY=0
case "${1:-}" in
    --backend-only)  BACKEND_ONLY=1 ;;
    --frontend-only) FRONTEND_ONLY=1 ;;
    "") ;;
    *) echo "用法: $0 [--backend-only|--frontend-only]" >&2; exit 2 ;;
esac

# 解析 JDK 21（本机默认可能是 JDK 8/11；仓库自带 toolchain 优先，homebrew 兜底）
resolve_jdk21() {
    local bundled
    for bundled in "$REPO_ROOT"/.skycode/toolchains/jdk21/*/Contents/Home; do
        if [ -x "$bundled/bin/java" ]; then JAVA_HOME="$bundled"; return 0; fi
    done
    if [ -x /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home/bin/java ]; then
        JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home; return 0
    fi
    if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then return 0; fi
    return 1
}

declare -a RESULTS

record() { RESULTS+=("$1"); }

# ── 后端 L0 ──
if [ "$FRONTEND_ONLY" -eq 0 ]; then
    if resolve_jdk21; then
        export JAVA_HOME
        echo "── 后端 smoke（@Tag('smoke') 22 类）──"
        if (cd "$REPO_ROOT/backend" && ./mvnw test "-Dgroups=smoke" -DfailIfNoTests=false -q >/dev/null 2>&1); then
            record "后端 smoke ✅"
        else
            record "后端 smoke ❌（重跑看详情: (cd backend && ./mvnw test '-Dgroups=smoke' -DfailIfNoTests=false)）"
        fi
    else
        record "后端 smoke ⚠️ 跳过（未找到 JDK 21）"
        echo "警告: 未找到 JDK 21，后端层跳过" >&2
    fi
fi

# ── 前端核心 ──
if [ "$BACKEND_ONLY" -eq 0 ]; then
    echo "── 前端核心（src/api + src/store）──"
    if (cd "$REPO_ROOT/frontend" && npx vitest run src/api src/store --reporter=dot >/dev/null 2>&1); then
        record "前端核心 ✅"
    else
        record "前端核心 ❌（重跑看详情: npx vitest run src/api src/store）"
    fi
fi

# ── Python ──
if [ "$BACKEND_ONLY" -eq 0 ]; then
    echo "── pytest 全量 ──"
    PY=python-service/.venv/bin/python
    if [ -x "$REPO_ROOT/$PY" ]; then
        if (cd "$REPO_ROOT/python-service" && ../$PY -m pytest tests/ -q -p no:cacheprovider >/dev/null 2>&1); then
            record "pytest ✅"
        else
            record "pytest ❌"
        fi
    else
        record "pytest ⚠️ 跳过（无本机 venv；容器方式: docker run --rm -v \$PWD/python-service:/svc:ro -w /svc --entrypoint /app/python-service/.venv/bin/python skycode:latest -m pytest tests/ -q -p no:cacheprovider）"
    fi
fi

echo ""
echo "═══ 冒烟结果 ═══"
exit_code=0
for r in "${RESULTS[@]}"; do
    echo "  $r"
    [[ "$r" == *"❌"* ]] && exit_code=1
done
exit $exit_code
