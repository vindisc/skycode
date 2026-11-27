/**
 * 显示方式切换的组件测试（消息展示密度）
 * 覆盖：顶栏下拉 DensityMenu（三档切换：setDensity + 清当前会话 overrides，其他会话保留；
 * 当前档选中态）；移动端单按钮 + 三选一菜单 MobileDensitySwitch（开关、选中、backdrop 收起）。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/store/sessionStore';
import { useTurnViewStore } from '@/store/turnViewStore';
import { DensityMenu, MobileDensitySwitch } from './DensitySwitch';

beforeEach(() => {
    localStorage.clear();
    useTurnViewStore.setState({ density: 'compact', expandOverrides: {} });
    useSessionStore.setState({ sessionId: 'sess-1' });
});

describe('DensityMenu 顶栏下拉', () => {
    it('触发按钮显示当前档；点开是三选一的面板，当前档为选中态', () => {
        useTurnViewStore.setState({ density: 'balanced' });
        render(<DensityMenu />);
        const trigger = screen.getByRole('button', { name: '显示方式：标准' });
        expect(trigger).toHaveTextContent('标准');
        expect(screen.queryByRole('dialog', { name: '显示方式' })).not.toBeInTheDocument();

        fireEvent.click(trigger);
        expect(screen.getByRole('dialog', { name: '显示方式' })).toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: /^精简/ })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: /^标准/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /^完整过程/ })).toHaveAttribute('aria-pressed', 'false');
    });

    it('选「完整过程」→ setDensity 生效并清空当前会话 overrides，其他会话保留', () => {
        useTurnViewStore.getState().setSectionExpanded('sess-1', '0', true);
        useTurnViewStore.getState().setSectionExpanded('sess-2', '3:0', false);

        render(<DensityMenu />);
        fireEvent.click(screen.getByRole('button', { name: /^显示方式/ }));
        fireEvent.click(screen.getByRole('button', { name: /^完整过程/ }));

        const state = useTurnViewStore.getState();
        expect(state.density).toBe('detailed');
        expect(state.expandOverrides['sess-1']).toBeUndefined();
        expect(state.expandOverrides['sess-2']).toEqual({ '3:0': false });
    });

    it('选「精简」→ density=compact，面板收起', () => {
        useTurnViewStore.setState({ density: 'balanced' });
        render(<DensityMenu />);
        fireEvent.click(screen.getByRole('button', { name: /^显示方式/ }));
        fireEvent.click(screen.getByRole('button', { name: /^精简/ }));
        expect(useTurnViewStore.getState().density).toBe('compact');
        expect(screen.queryByRole('dialog', { name: '显示方式' })).not.toBeInTheDocument();
    });
});

describe('MobileDensitySwitch 移动端菜单', () => {
    it('chip 显示当前档，点击弹出三选一菜单', () => {
        useTurnViewStore.setState({ density: 'balanced' });
        render(<MobileDensitySwitch />);
        const chip = screen.getByTestId('mobile-density-chip');
        expect(chip).toHaveTextContent('标准');
        expect(screen.queryByTestId('mobile-density-menu')).not.toBeInTheDocument();

        fireEvent.click(chip);
        const menu = screen.getByTestId('mobile-density-menu');
        expect(menu).toBeInTheDocument();
        expect(chip).toHaveAttribute('aria-expanded', 'true');
        // 当前档项标记 aria-pressed
        expect(screen.getByRole('button', { name: /^标准/ }))
            .toHaveAttribute('aria-pressed', 'true');
    });

    it('菜单选择「完整过程」→ 切档并收起菜单', async () => {
        render(<MobileDensitySwitch />);
        fireEvent.click(screen.getByTestId('mobile-density-chip'));
        fireEvent.click(screen.getByRole('button', { name: /^完整过程/ }));
        expect(useTurnViewStore.getState().density).toBe('detailed');
        await waitFor(() => expect(screen.queryByTestId('mobile-density-menu')).not.toBeInTheDocument());
        expect(screen.getByTestId('mobile-density-chip')).toHaveTextContent('完整过程');
    });

    it('菜单选择走当前 sessionId 清空其 overrides', () => {
        useTurnViewStore.getState().setSectionExpanded('sess-1', '0:1', true);
        render(<MobileDensitySwitch />);
        fireEvent.click(screen.getByTestId('mobile-density-chip'));
        fireEvent.click(screen.getByRole('button', { name: /^标准/ }));
        expect(useTurnViewStore.getState().density).toBe('balanced');
        expect(useTurnViewStore.getState().expandOverrides['sess-1']).toBeUndefined();
    });
});
