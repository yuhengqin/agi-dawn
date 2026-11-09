import { useEffect, useState } from "react";
import { InfoLink } from "../components/shell/InfoLink";
import type { ChangelogRelease, ChangelogResponse } from "@agidawn/contracts/site";
import { SITE } from "@agidawn/site";
import { useLoaderData } from "react-router";
import { apiGet, cachedPage } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { pageMeta } from "../lib/seo";
import { setChangelogSeen } from "../lib/local-state";
import { AsideCard, ReadingLayout } from "../components/ui/Page";
import { IconChevronRight } from "../components/icons";
import { ChangelogEntries, KIND_DOT } from "../features/changelog/ChangelogEntries";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "me", name: "更新日志" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

type Release = ChangelogRelease;

export async function loader({ request }: { request: Request }) {
  return cachedPage(300, await apiGet<ChangelogResponse>("/api/site/changelog", { signal: request.signal }));
}

export function meta() {
  return pageMeta({ title: "更新日志", description: `${SITE.name} 的功能更新、优化、公告与下线记录。`, path: "/changelog", image: "/og/pages/changelog.png" });
}

const KINDS = Object.keys(KIND_DOT) as Release["kind"][];

export default function ChangelogPage() {
  const data = useLoaderData<typeof loader>();
  useEffect(() => setChangelogSeen(data.latestVersion), [data.latestVersion]);
  const [kind, setKind] = useState<Release["kind"] | null>(null);
  const visibleReleases = data.releases.filter((r) => !kind || r.kind === kind);
  const groups = new Map<string, Release[]>();
  for (const r of visibleReleases) groups.set(r.date, [...(groups.get(r.date) ?? []), r]);
  // Month → the newest date shown in it (the jump target) and how many entries it holds.
  const months = new Map<string, { first: string; count: number }>();
  for (const [date, releases] of groups) {
    const month = months.get(date.slice(0, 7)) ?? { first: date, count: 0 };
    month.count += releases.length;
    months.set(date.slice(0, 7), month);
  }

  const aside = (
    <>
      <AsideCard title="按类型看" className="hidden lg:block">
        <div className="-mx-2 -mb-1">
          {[null, ...KINDS].map((k) => (
            <button
              key={k ?? "all"}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left text-[13.5px] transition-colors ${kind === k ? "bg-well font-medium text-ink" : "text-ink-2 hover:bg-bg-sunk hover:text-ink"}`}
            >
              <span className={`size-1.5 rounded-full ${k ? KIND_DOT[k] : "bg-ink-2"}`} aria-hidden="true" />
              <span className="flex-1">{k ?? "全部"}</span>
              <span className="num text-[12px] text-ink-4">{k ? data.releases.filter((r) => r.kind === k).length : data.releases.length}</span>
            </button>
          ))}
        </div>
      </AsideCard>
      <AsideCard title="按月份" className="hidden lg:block">
        <nav aria-label="按月份" className="-mx-2 -mb-1">
          {[...months.entries()].map(([month, m]) => {
            const [y, mo] = month.split("-").map(Number) as [number, number];
            return (
              <a key={month} href={`#d-${m.first}`} className="flex items-center justify-between rounded-control px-2 py-2 text-[13.5px] text-ink-2 transition-colors hover:bg-bg-sunk hover:text-ink">
                {y} 年 {mo} 月<span className="num text-[12px] text-ink-4">{m.count} 条</span>
              </a>
            );
          })}
        </nav>
      </AsideCard>
      <AsideCard title="有想法或遇到问题">
        <p className="text-[13px] leading-[1.75] text-ink-3">想要的功能、用着不顺的地方，都可以在反馈页告诉我们。</p>
        <InfoLink viewTransition to="/feedback" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
          去反馈 <IconChevronRight size={14} />
        </InfoLink>
      </AsideCard>
    </>
  );

  return (
    <>
    <PhoneBar back={{ to: "/more", label: "我的" }} title="更新日志" />
    <ReadingLayout aside={aside}>
      <header className="pb-6">
        <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">更新日志</h1>
        <p className="mt-1.5 text-[13px] text-ink-3">新功能、调整、下线，都写在这里。</p>
      </header>
      <ChangelogEntries releases={visibleReleases} />
    </ReadingLayout>
    </>
  );
}
