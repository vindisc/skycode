#!/usr/bin/env python3
"""校验 requirements.lock 覆盖 requirements.txt 的每一个条目。

lock 是 pip freeze 的全量钉版清单（Dockerfile 用它安装），requirements.txt 是人工维护的清单。
两边的写法允许不同（extras、大小写、>= 范围），但语义必须一致：
  - requirements.txt 里的 ==x.y.z   → lock 里同名字段必须是同一版本
  - requirements.txt 里的 >=a.b.c   → lock 里同名条目的版本不得低于下限
比较按 PEP 503 规范化包名（大小写不敏感，-/_/. 等价），extras（[standard] 等）忽略。

Usage: python3 scripts/check-deps.py   （在仓库根目录执行）
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REQ = Path("python-service/requirements.txt")
LOCK = Path("python-service/requirements.lock")


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_entries(path: Path) -> dict[str, list[str]]:
    """返回 {规范包名: [约束字符串, ...]}，忽略注释与空行。"""
    entries: dict[str, list[str]] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()  # 去行内注释
        if not line:
            continue
        m = re.match(r"^([A-Za-z0-9._-]+)(\[[^\]]*\])?(.*)$", line)
        if not m:
            print(f"ERROR: 无法解析 {path} 里的行：{raw!r}")
            sys.exit(1)
        entries.setdefault(normalize(m.group(1)), []).append(m.group(3).strip())
    return entries


def version_tuple(version: str) -> tuple[int, ...]:
    parts: list[int] = []
    for piece in re.split(r"[.+\-]", version):
        if piece.isdigit():
            parts.append(int(piece))
    return tuple(parts)


def main() -> int:
    req = parse_entries(REQ)
    lock = parse_entries(LOCK)
    errors: list[str] = []

    for name, constraints in req.items():
        locked = lock.get(name)
        if locked is None:
            errors.append(f"lock 里缺包：{name}")
            continue
        locked_version = locked[0].lstrip("=!<~> ").strip()
        for constraint in constraints:
            if constraint.startswith("=="):
                want = constraint[2:].strip()
                if locked_version != want:
                    errors.append(f"{name}: txt 钉了 {want}，lock 是 {locked_version}")
            elif constraint.startswith(">="):
                floor = version_tuple(constraint[2:].strip())
                actual = version_tuple(locked_version)
                if actual < floor:
                    errors.append(f"{name}: txt 要求 >={constraint[2:]!r}，lock 是 {locked_version}")
            elif constraint in ("", "*"):
                pass
            else:
                errors.append(f"{name}: 不认识的约束写法 {constraint!r}（本脚本只支持 == 与 >=）")

    # 反向检查：lock 里的包如果 txt 完全没提也提示一下（信息性，不判失败）
    extras_only = sorted(set(lock) - set(req))
    if extras_only:
        print(f"提示：lock 里比 txt 多出 {len(extras_only)} 个传递依赖（正常，freeze 全量清单）")

    if errors:
        for e in errors:
            print(f"ERROR: {e}")
        print("ERROR: Dependency mismatch detected")
        return 1
    print(f"Dependencies match lock file（txt {len(req)} 个包全部被 lock 覆盖）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
