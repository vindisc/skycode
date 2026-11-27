/**
 * EmptyHero — 没有会话内容时的起步提示
 *
 * Skymap 的空态是一张"工作提示"小卡片（图标 + 15px 标题 + 一句说明 + 动作），不是营销页。
 * 这里同样只放一张卡：四条起步任务点击后把模板文本填进输入框并聚焦，不提交
 * （CustomEvent 桥，零跨组件耦合，见 services/promptTemplateFill）；真正的输入在下方停靠的输入条带里。
 */

import { Bug, FlaskConical, FolderTree, ListChecks } from 'lucide-react';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { Button } from '@/components/ui';
import { dispatchPromptTemplateFill } from '@/services/promptTemplateFill';

interface QuickChip {
    label: string;
    icon: typeof FolderTree;
    template: string;
}

/** 起步任务：面向"打开了一个项目、还没想好从哪开始"的时刻。 */
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
        <div className="flex h-full items-start justify-center overflow-y-auto px-6 pt-[15vh]" data-testid="empty-hero">
            <section className="w-full max-w-[460px] rounded-md border border-hairline bg-surface2 px-7 pb-6 pt-7 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-sm bg-hover2">
                    <BrandLogo className="h-7 w-7" />
                </div>
                <h1 className="text-15 font-semibold text-t1">描述任务，SkyCode 开始工作</h1>
                <p className="mt-1.5 text-13 leading-relaxed text-t2">读代码、改文件、跑命令，过程随时可查</p>
                <div className="mt-5 grid grid-cols-2 gap-2">
                    {QUICK_CHIPS.map((chip) => (
                        <Button
                            key={chip.label}
                            variant="secondary"
                            size="sm"
                            className="justify-start text-t2"
                            onClick={() => dispatchPromptTemplateFill(chip.template)}
                        >
                            <chip.icon className="h-3.5 w-3.5 shrink-0 text-accent2-ink" aria-hidden="true" />
                            <span className="truncate">{chip.label}</span>
                        </Button>
                    ))}
                </div>
            </section>
        </div>
    );
}
