import { useEffect, useState } from "react";
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
import { IconGithub,IconChevronDown } from "../icons";

/** True while the changelog has an entry newer than the one this reader last opened. */
export function useChangelogDot(latestVersion: string | null): boolean {
  const seen = useChangelogSeen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !latestVersion) return false;
  return !seen || seen < latestVersion;
}

function SideLink({ item, dot }: { item: NavItem; dot: boolean }) {
  const { pathname } = useLocation();
  const isActive = sidebarIsActive(item, pathname);
  const Icon = item.icon;
  return (
    <IntentLink
      to={item.to}
      aria-current={isActive ? "page" : undefined}
      className={`flex h-10 items-center gap-2.5 rounded-control px-2.5 text-[14px] transition-colors duration-150 ${
        isActive ? "font-semibold text-accent" : "font-medium text-ink-3 hover:bg-bg-sunk hover:text-ink"
      }`}
    >
      <span className={`flex w-[22px] shrink-0 justify-center ${isActive ? "text-accent" : ""}`}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
      {dot && item.changelog && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-hot" aria-label="有新的更新" />}
    </IntentLink>
  );
}

export function Sidebar({ changelogVersion,categories,initiallyCollapsed }: { changelogVersion: string | null;categories:ReaderPageData['categories'];initiallyCollapsed:boolean }) {
  const dot = useChangelogDot(changelogVersion);
  const {pathname}=useLocation();
  const reader=useRouteLoaderData<ReaderPageData>('routes/home');
  const article=useRouteLoaderData<ReaderItemDetail>('routes/item');
  const [collapsed,setCollapsed]=useState(initiallyCollapsed);
  const currentCategory=reader?(reader.query.category??''):article?(article.category??'uncategorized'):null;
  const categoryItems=reader?.categories??categories;
  const categoryName=categoryItems.find(category=>category.id===currentCategory)?.name;
  const sections=sidebar(),footerLinks=sections.flatMap(section=>section.items).filter(item=>['/about','/changelog','/feedback'].includes(item.to));
  return (
    <aside className="sticky top-0 hidden h-dvh w-[194px] shrink-0 flex-col border-r border-line bg-sidebar px-3.5 pb-3.5 pt-6 lg:flex">
      <Link to="/" className="mb-4 flex h-[50px] items-center px-1 text-ink" aria-label={`${SITE.name} 首页`}>
        <Wordmark size={26} />
      </Link>
      <nav className="scrollbar-thin -mx-1 flex-1 overflow-y-auto px-1" aria-label="主导航">
        <div className={`mb-3 border-b border-line ${collapsed?'':'pb-3'}`}>
          <button type="button" aria-expanded={!collapsed} aria-controls="sidebar-categories" className={`flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm font-medium text-ink hover:bg-bg-sunk focus-visible:outline-2 focus-visible:outline-accent ${collapsed?'':'border-b border-line'}`} onClick={()=>{
            const next=!collapsed;setCollapsed(next);document.cookie=`reader_categories=${next?'closed':'open'}; Path=/; Max-Age=31536000; SameSite=Lax`;
          }}><span className="min-w-0 break-words py-2">类别{collapsed&&categoryName?` · ${categoryName}`:''}</span><IconChevronDown size={18} className={`shrink-0 ${collapsed?'-rotate-90':''}`}/></button>
          <div id="sidebar-categories" hidden={collapsed} className="pt-2"><CategoryNavigation categories={categoryItems} query={reader?.query??{}} currentCategory={currentCategory}/></div>
        </div>
        {sections.map((section) => (
          <div key={section.title}>
            {!['内容','更多'].includes(section.title)&&<div className="px-2.5 pb-1 pt-3.5 text-[11px] text-ink-4">{section.title}</div>}
            <div className="flex flex-col gap-1">
              {section.items.filter(item=>item.to!=='/'&&!footerLinks.includes(item)).map((item) => (
                <SideLink key={item.to} item={item} dot={dot}/>
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-x-3 gap-y-2 px-2.5 py-4 text-xs text-ink-3">{footerLinks.map(item=><Link key={item.to} to={item.to} aria-current={sidebarIsActive(item,pathname)?'page':undefined} className="inline-flex items-center gap-1 hover:text-ink aria-[current=page]:text-accent">{item.label}{dot&&item.changelog&&<span className="size-1.5 rounded-full bg-hot" aria-label="有新的更新"/>}</Link>)}</div>
      </nav>
      <div className="mt-2 space-y-2.5 px-1 pt-1">
        {SITE.github && (
          <a
            href={SITE.github}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-1 flex h-[34px] items-center justify-center gap-1.5 rounded-full border border-line text-[12.5px] text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink"
          >
            <IconGithub size={14} />
            GitHub 开源
          </a>
        )}
        {/* The full width keeps the longer public-security number on one line. */}
        <div className="-mx-1 flex flex-col items-center gap-1.5">
          <Filings className="whitespace-nowrap text-[9.5px] leading-[1.3] text-ink-4 hover:text-ink-3" badgeSize={10} />
        </div>
      </div>
    </aside>
  );
}
