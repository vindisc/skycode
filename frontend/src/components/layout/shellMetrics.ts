/**
 * 外壳的固定尺寸（px）。
 *
 * AppLayout 把它们换算成 --sidebar-track / --inspector-track 写在根节点上，顶栏的状态行靠这两个值
 * 居中到工作区（见 globals.css 的 .app-header-grid）。单独放一个不带组件的模块，
 * 是因为侧栏的实际宽度由 Sidebar 在运行时写进 :root 的 --sidebar-w，这里只放兜底值。
 */

/** 窗口四周的留边（globals.css 的 .app-body） */
export const SHELL_PADDING = 8;
/** 面板之间的缝（.app-body 的 gap） */
export const SHELL_GAP = 10;

/** 桌面侧栏的默认宽度 */
export const DEFAULT_SIDEBAR_WIDTH = 300;

/** 右侧检查器的宽度（对应 AppLayout 里它的 w-80） */
export const INSPECTOR_WIDTH = 320;
/** 视口窄于这个宽度时不显示检查器（见 useInspectorVisible） */
export const INSPECTOR_MIN_WIDTH = 1280;
