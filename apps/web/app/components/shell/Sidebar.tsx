import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useLocation, useRouteLoaderData } from "react-router";
import {CategoryNavigation} from "../../features/feed/ReaderNavigation";
import type {ReaderPageData} from "../../features/feed/reader.server";
import type {ReaderItemDetail} from "@agidawn/contracts/site";
import { IntentLink } from "../ui/IntentLink";
import { SITE } from "@agidawn/site";
import { Wordmark } from "@agidawn/site/brand/Logo.tsx";
import { useChangelogSeen } from "../../lib/local-state";
import { sidebar, sidebarIsActive, type NavItem } from "./nav";
import { Filings } from "./Filings";
import { InfoLink } from "./InfoLink";
import { IconBookmark, IconChevronDown, IconGithub, IconSidebar, IconUser } from "../icons";

export const DEFAULT_SIDEBAR_WIDTH = 194;
export const COLLAPSED_SIDEBAR_WIDTH = 60;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 280;

const linkClass = "flex min-h-10 items-center gap-2.5 rounded-control px-2.5 text-[14px] font-medium text-ink-3 hover:bg-bg-sunk hover:text-ink data-[active=true]:bg-accent/10 data-[active=true]:font-semibold data-[active=true]:text-accent";
const footerDot = <span className="block size-1.5 shrink-0 rounded-full bg-hot" aria-hidden="true" />;
const hasFilings = Boolean(SITE.icp || SITE.psb);

/** True while the changelog has an entry newer than the one this reader last opened. */
export function useChangelogDot(latestVersion: string | null): boolean {
  const seen = useChangelogSeen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !latestVersion) return false;
  return !seen || seen < latestVersion;
}

function SideLink({ item, dot = false, collapsed = false, dialogOpener }: {
  item: NavItem; dot?: boolean; collapsed?: boolean; dialogOpener?: RefObject<HTMLButtonElement | null>;
}) {
  const { pathname } = useLocation();
  const isActive = sidebarIsActive(item, pathname);
  const inArticle = item.to === "/" && pathname.startsWith("/items/");
  const unread = dot && item.changelog;
  const Icon = item.icon;
  const props = {
    to: item.to,
    "aria-current": isActive ? "page" as const : undefined,
    "aria-description": unread ? "有新的更新" : undefined,
    "data-active": isActive || inArticle,
    title: collapsed ? item.label : undefined,
    className: `${linkClass} ${collapsed ? "justify-center" : ""}`,
  };
  const content = <>
      <span className="flex w-5 shrink-0 justify-center">
        <Icon size={17} />
      </span>
      <span className={collapsed ? "sr-only" : "min-w-0 truncate"}>{item.label}</span>
      {unread && <span className="ml-auto">{footerDot}</span>}
  </>;
  return dialogOpener
    ? <InfoLink {...props} opener={dialogOpener} aria-haspopup={isActive ? undefined : "dialog"}>{content}</InfoLink>
    : <IntentLink {...props}>{content}</IntentLink>;
}

function SidebarOptions({ items, dot, collapsed }: { items: NavItem[]; dot: boolean; collapsed: boolean }) {
  const { key, pathname } = useLocation();
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { panel.current?.hidePopover?.(); }, [key, collapsed]);
  const active = pathname === "/more" || items.some(item => sidebarIsActive(item, pathname));
  return (
    <div className="shrink-0 border-t border-line pt-2" onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) panel.current?.hidePopover?.();
    }}>
      <button
        ref={trigger}
        type="button"
        popoverTarget="sidebar-options"
        title={collapsed ? "我的" : undefined}
        aria-description={dot ? "有新的更新" : undefined}
        data-active={active}
        className={`sidebar-options-trigger relative h-11 w-full ${linkClass} ${collapsed ? "justify-center" : ""}`}
      >
        <span className="relative flex w-5 shrink-0 justify-center">
          <IconUser size={18} />
          {collapsed && dot && <span className="absolute -right-1 -top-1">{footerDot}</span>}
        </span>
        <span className={collapsed ? "sr-only" : "flex-1 text-left"}>我的</span>
        {!collapsed && <>{dot && footerDot}<IconChevronDown size={15} className="sidebar-options-chevron shrink-0" /></>}
      </button>
      <section id="sidebar-options" ref={panel} popover="auto" aria-label="我的选项" className="sidebar-options scrollbar-thin" data-collapsed={collapsed}
        onClick={event => {
          if ((event.target as Element).closest("a")) panel.current?.hidePopover?.();
        }}>
        {/* A document navigation lets the admin loader redirect signed-out readers through the API. */}
        <Link to="/admin/reader" reloadDocument className={linkClass}>
          <span className="flex w-5 shrink-0 justify-center"><IconBookmark size={17} /></span>
          后台管理
        </Link>
        <div className="my-1 border-t border-line-soft" />
        {items.map(item => <SideLink key={item.to} item={item} dot={dot} dialogOpener={trigger} />)}
        {SITE.github && (
          <a href={SITE.github} target="_blank" rel="noopener noreferrer" className={linkClass}>
            <IconGithub size={17} />
            GitHub 开源
          </a>
        )}
        {collapsed && hasFilings && <SidebarFilings />}
      </section>
    </div>
  );
}

function SidebarFilings() {
  return <div className="flex shrink-0 flex-col items-center gap-1.5 px-1 py-2">
    <Filings className="text-[9.5px] leading-[1.3] text-ink-4 hover:text-ink-3" badgeSize={10} />
  </div>;
}

export function Sidebar({ changelogVersion, categories, initiallyCategoriesCollapsed, collapsed, width, onToggle, onResize }: {
  changelogVersion: string | null;
  categories: ReaderPageData["categories"];
  initiallyCategoriesCollapsed: boolean;
  collapsed: boolean;
  width: number;
  onToggle: () => void;
  onResize: (width: number) => void;
}) {
  const dot = useChangelogDot(changelogVersion);
  const reader = useRouteLoaderData<ReaderPageData>("routes/home");
  const article = useRouteLoaderData<ReaderItemDetail>("routes/item");
  const [categoriesCollapsed, setCategoriesCollapsed] = useState(initiallyCategoriesCollapsed);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const currentCategory = reader ? (reader.query.category ?? "") : article ? (article.category ?? "uncategorized") : null;
  const categoryItems = reader?.categories ?? categories;
  const categoryName = categoryItems.find(category => category.id === currentCategory)?.name;
  const [primary, ...sections] = sidebar();
  const options = sections.pop()!.items.filter(item => item.to !== "/more");
  const resize = (value: number) => onResize(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, value)));
  const toggleLabel = collapsed ? "展开侧栏" : "收起侧栏";
  return (
    <aside id="desktop-sidebar" className="site-sidebar sticky top-0 hidden h-dvh w-[var(--desktop-sidebar-width)] shrink-0 flex-col border-r border-line bg-sidebar px-2.5 pb-3 pt-4 lg:flex">
      <div className={`mb-3 flex h-11 shrink-0 items-center ${collapsed ? "justify-center" : "justify-between gap-1 pl-1"}`}>
        {!collapsed && <Link to="/" className="flex min-w-0 items-center text-ink" aria-label={`${SITE.name} 首页`}>
          <Wordmark size={24} />
        </Link>}
        <button type="button" aria-label={toggleLabel} title={toggleLabel} aria-controls="sidebar-navigation" aria-expanded={!collapsed}
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-control text-ink-3 hover:bg-bg-sunk hover:text-ink"
          onClick={onToggle}>
          <IconSidebar size={18} />
        </button>
      </div>
      <nav id="sidebar-navigation" aria-label="主导航" className="flex min-h-0 flex-1 flex-col">
        <div className="grid shrink-0 gap-0.5">
          {primary?.items.map(item => <SideLink key={item.to} item={item} collapsed={collapsed} />)}
        </div>
        <div className="scrollbar-thin -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {!collapsed && <div className="mt-3 border-t border-line pt-2">
            <button type="button" aria-expanded={!categoriesCollapsed} aria-controls="sidebar-categories"
              className="flex min-h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-control px-2.5 text-left text-[13px] font-medium text-ink-3 hover:bg-bg-sunk hover:text-ink"
              onClick={() => {
                const next = !categoriesCollapsed;
                setCategoriesCollapsed(next);
                document.cookie = `reader_categories=${next ? "closed" : "open"}; Path=/; Max-Age=31536000; SameSite=Lax`;
              }}>
              <span className="min-w-0 break-words py-1">类别{categoriesCollapsed && categoryName ? ` · ${categoryName}` : ""}</span>
              <IconChevronDown size={16} className={`shrink-0 ${categoriesCollapsed ? "-rotate-90" : ""}`} />
            </button>
            <div id="sidebar-categories" hidden={categoriesCollapsed} className="pt-1">
              <CategoryNavigation categories={categoryItems} query={reader?.query ?? {}} currentCategory={currentCategory} />
            </div>
          </div>}
          {sections.map(section => <div key={section.title} className="mt-3 grid gap-0.5">
            {!collapsed && <div className="px-2.5 pb-1 text-[11px] text-ink-4">{section.title}</div>}
            {section.items.map(item => <SideLink key={item.to} item={item} collapsed={collapsed} />)}
          </div>)}
        </div>
      </nav>
      {!collapsed && hasFilings && <SidebarFilings />}
      <SidebarOptions items={options} dot={dot} collapsed={collapsed} />
      {!collapsed && <div role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-controls="desktop-sidebar"
        aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={MAX_SIDEBAR_WIDTH} aria-valuenow={width} aria-valuetext={`${width} 像素`}
        title="拖动调整侧栏宽度" tabIndex={0} className="sidebar-resize-handle"
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          drag.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
            resize(drag.current.width + event.clientX - drag.current.x);
          }
        }}
        onLostPointerCapture={() => { drag.current = null; }}
        onDoubleClick={() => resize(DEFAULT_SIDEBAR_WIDTH)}
        onKeyDown={event => {
          const next = { ArrowLeft: width - 8, ArrowRight: width + 8, Home: MIN_SIDEBAR_WIDTH, End: MAX_SIDEBAR_WIDTH }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          resize(next);
        }} />}
    </aside>
  );
}
