import { Link } from "react-router";
import { ABOUT, SITE } from "@agidawn/site";
import { InfoLink } from "./InfoLink";

export function AboutContent({ compact = false }: { compact?: boolean }) {
  return <>
    <p className={`leading-relaxed text-ink-2 ${compact ? "mb-4 text-[15px]" : "my-6 text-lg"}`}>{SITE.description}</p>
    <section className={`border-y border-line ${compact ? "space-y-3 py-4" : "space-y-7 py-6"}`}>
      {[
        ["收录", ABOUT.steps.collect],
        ["阅读", ABOUT.steps.store],
        ["查找", ABOUT.steps.select],
        ["保存", ABOUT.steps.publish],
      ].map(([title, text]) => <div key={title}>
        <h2 className={compact ? "text-sm font-semibold" : "text-xl font-semibold"}>{title}</h2>
        <p className={`mt-1 leading-relaxed text-ink-2 ${compact ? "text-sm" : ""}`}>{text}</p>
      </div>)}
    </section>
    <p className={`leading-relaxed text-ink-3 ${compact ? "my-4 text-sm" : "my-6"}`}>原文版权归各来源所有，全文展示以来源许可为准。站主的收藏、阅读状态和笔记只对站主本人开放。</p>
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-accent">
      <Link to="/explore?view=sources" className="hover:underline">查看来源</Link>
      <InfoLink to="/feedback" className="hover:underline">更正与反馈</InfoLink>
      <Link to="/admin/reader" reloadDocument className="hover:underline">站主空间</Link>
    </div>
  </>;
}
