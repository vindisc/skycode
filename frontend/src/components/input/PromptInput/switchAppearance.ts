/** 输入框底部切换行（模型 / 权限 / 显示方式）里控件的安静外观：小字，颜色由所在行的
 *  .composer-meta-row 统一压暗（悬停 / 聚焦恢复到主文字色）。
 *  relative 不能少：模型切换的透明下拉框靠它限定在这一小块里，否则会盖住旁边的其它按钮。 */
export const QUIET_SWITCH_CLASS =
    'relative inline-flex h-6 min-w-0 max-w-[180px] items-center gap-1 rounded-sm px-1.5 ' +
    'transition-colors duration-fast hover:bg-hover2 hover:text-t1 ' +
    'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring ' +
    'focus-within:ring-[3px] focus-within:ring-accent2-ring disabled:opacity-50';

/** 切换控件末尾的小箭头（颜色跟随所在行的 .composer-meta-row） */
export const QUIET_CHEVRON_CLASS = 'shrink-0';
