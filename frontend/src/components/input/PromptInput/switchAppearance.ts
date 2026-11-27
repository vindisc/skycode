/** 顶栏状态行里切换控件（模型 / 权限 / 显示方式）的安静外观：等宽小字，悬停才铺底。
 *  字号和等宽字体跟随状态行本身；只在顶栏用，输入区不再放这些控件。 */
export const QUIET_SWITCH_CLASS =
    // relative 不能少：模型切换的透明下拉框靠它限定在这一小块里，否则会盖住顶栏中间的其它按钮
    'relative inline-flex h-6 min-w-0 max-w-[180px] items-center gap-1 rounded-sm px-1.5 text-t3 ' +
    'transition-colors duration-fast hover:bg-hover2 hover:text-t1 ' +
    'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring ' +
    'focus-within:ring-[3px] focus-within:ring-accent2-ring disabled:opacity-50';

/** 切换控件末尾的小箭头 */
export const QUIET_CHEVRON_CLASS = 'shrink-0 text-t4';
