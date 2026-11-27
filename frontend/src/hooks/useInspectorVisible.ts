/**
 * useInspectorVisible — 右侧检查器是否可见
 *
 * 可见 = 用户没有收起，且视口 ≥1280px。再窄的话，左栏加检查器会把工作区挤到 370px 以下。
 * 收起（或窄屏）时，模型 / 权限 / 显示方式三个控件回到输入条带，功能在任何宽度都可达。
 *
 * 宽度用媒体查询判断而不是 useViewportWidth：不新增模块依赖，测试环境（没有 matchMedia）里
 * 自然得到「不可见」，输入条带的行为与引入检查器之前一致。
 */

import { useEffect, useState } from 'react';
import { useAppUiStore } from '@/store/appUiStore';

export const INSPECTOR_MIN_WIDTH = 1280;

const QUERY = `(min-width: ${INSPECTOR_MIN_WIDTH}px)`;

/** 视口是否够宽到可以放检查器（与用户有没有收起无关） */
export function useInspectorAvailable(): boolean {
    const [wide, setWide] = useState(() =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia(QUERY);
        const onChange = () => setWide(query.matches);
        onChange();
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);

    return wide;
}

export function useInspectorVisible(): boolean {
    const open = useAppUiStore(s => s.inspectorOpen);
    const wide = useInspectorAvailable();
    return open && wide;
}
