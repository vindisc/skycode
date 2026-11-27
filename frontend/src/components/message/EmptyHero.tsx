/**
 * EmptyHero — §7.1 空态 Hero（记忆点①）
 *
 * 结构（ui EmptyState hero 变体承载）：
 * 1. 徽章：现有品牌 Logo + skycode；
 * 2. 标题：今天想<b>创造</b>什么？（clamp(34px,5.4vw,50px)/300/-0.02em，<b>=650+accent，
 *    移动端固定 34px —— 经 [&_h1]:max-md 覆盖）；
 * 3. 副文案（text-t3 档、1.7 行高，EmptyState hero 内置）；
 * 4. 快捷 chips ×4：icon accent + text-t2，surface+hairline+shadow-e1，
 *    hover 上移 2px 升 e2；点击只「填入模板文本 + 聚焦输入框」，不提交
 *    （CustomEvent 桥，零跨组件耦合，见 services/promptTemplateFill）；
 * 5. kbd 提示条（ui Kbd，text-t4；仅 ≥768px 显示，手机触屏无快捷键意义）。
 * 移动端：标题固定 34px、上下留白减半（py-12 → py-6）。
 */

import { Bug, FlaskConical, FolderTree, ListChecks } from 'lucide-react';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { Button, Chip, EmptyState, Kbd } from '@/components/ui';
import { dispatchPromptTemplateFill } from '@/services/promptTemplateFill';

interface QuickChip {
    label: string;
    icon: typeof FolderTree;
    template: string;
}

/** 起步任务：面向"打开了一个项目、还没想好从哪开始"的时刻。
 *  原先这里是四条上游演示案例（王者荣耀、12306、黄金投资、宇树 Excel），和编程工作台的定位对不上。 */
const QUICK_CHIPS: QuickChip[] = [
    {
        label: '梳理项目结构',
        icon: FolderTree,
        template: '请梳理这个项目的目录结构和主要模块，说明各模块的职责和它们之间的调用关系，整理成一份简明的项目导览。这一步只读，先不要修改任何文件。',
    },
    {
        label: '修复一个问题',
        icon: Bug,
        template: '帮我排查并修复一个问题：先阅读相关代码和最近的改动，定位原因并说明依据，再实施修复，完成后运行相关测试验证。',
    },
    {
        label: '补单元测试',
        icon: FlaskConical,
        template: '请查看最近的代码改动，找出其中缺少测试覆盖的关键逻辑，补上单元测试，并运行测试确认全部通过。',
    },
    {
        label: '跑测试并总结',
        icon: ListChecks,
        template: '运行这个项目的测试，把失败的用例逐个分析原因，区分是代码问题还是环境问题，并给出修复建议。先不要改动代码。',
    },
];

export function EmptyHero() {
    return (
        // h-full 保持原 min-h-full 垂直居中链不变
        <div className="relative h-full">
            <EmptyState
            variant="hero"
            className="relative [&_h1]:max-md:text-[34px] [&>p]:text-t2 min-h-full max-md:py-6"
            badge={
                <Chip variant="accent" className="h-7 px-3">
                    <BrandLogo className="h-5 w-5" />
                    <span>SkyCode</span>
                </Chip>
            }
            title={<>今天想<b>创造</b>什么？</>}
            description="描述任务，SkyCode 会读代码、改文件、跑命令，过程随时可查"
            actions={
                <>
                    {/* 四条起步任务固定成一行（窄屏两列），不随按钮宽度掉成 3+1 */}
                    <div className="grid basis-full grid-cols-2 justify-items-center gap-2 sm:grid-cols-4">
                        {QUICK_CHIPS.map((chip) => (
                            <Button
                                key={chip.label}
                                variant="secondary"
                                size="sm"
                                className="text-t2 hover:-translate-y-0.5"
                                onClick={() => dispatchPromptTemplateFill(chip.template)}
                            >
                                <chip.icon className="h-3.5 w-3.5 text-accent2-ink" aria-hidden="true" />
                                {chip.label}
                            </Button>
                        ))}
                    </div>
                    <div className="mt-3 hidden basis-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-13 text-t2 md:flex">
                        <span className="flex items-center gap-1">
                            <Kbd>⌘</Kbd><Kbd>K</Kbd> 命令面板
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="flex items-center gap-1">
                            <Kbd>⌘</Kbd><Kbd>⏎</Kbd> 发送
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="flex items-center gap-1">
                            <Kbd>Esc</Kbd> 中断任务
                        </span>
                    </div>
                </>
            }
        />
        </div>
    );
}
