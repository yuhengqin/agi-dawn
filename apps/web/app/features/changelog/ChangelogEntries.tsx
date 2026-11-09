import type { ComponentType } from "react";
import type { ChangelogRelease } from "@agidawn/contracts/site";
import { Inline, dateHeading } from "./text";

type Release = ChangelogRelease;

export const KIND_DOT: Record<Release["kind"], string> = {
  更新: "bg-accent",
  优化: "bg-ok",
  公告: "bg-amber",
  下线: "bg-ink-4",
};

function ReleaseBody({ lines }: { lines: string[] }) {
  const blocks: Array<string | string[]> = [];
  for (const line of lines) {
    const last = blocks.at(-1);
    if (!line.startsWith("- ")) blocks.push(line);
    else if (Array.isArray(last)) last.push(line.slice(2));
    else blocks.push([line.slice(2)]);
  }
  const text = "mt-2 max-w-[52em] text-[13.5px] leading-[1.8] text-ink-3";
  return blocks.map((b, i) =>
    Array.isArray(b) ? (
      <ul key={i} className={`${text} space-y-1`}>
        {b.map((li, j) => (
          <li key={j} className="flex gap-2">
            <span className="mt-[11px] size-1 shrink-0 rounded-full bg-ink-4" aria-hidden="true" />
            <span>
              <Inline text={li} />
            </span>
          </li>
        ))}
      </ul>
    ) : (
      <p key={i} className={text}>
        <Inline text={b} />
      </p>
    ),
  );
}

/** One date's releases in a card; `id` is the jump target of the month index. */
function Day({ date, releases, id }: { date: string; releases: Release[]; id?: string }) {
  const h = dateHeading(date);
  return (
    <section id={id} className="card scroll-mt-[calc(var(--bar-h)+1.5rem)] px-5 lg:px-7">
      <h2 className="flex items-baseline gap-3 border-b border-line-soft py-4">
        <time dateTime={date} className="text-[18px] font-bold text-ink">
          {h.label}
        </time>
        <span className="text-[12px] text-ink-4">{h.weekday}</span>
      </h2>
      <ol>
        {releases.map((r) => (
          <li
            key={`${r.date}-${r.time}-${r.title}`}
            className={`grid gap-x-8 gap-y-2 border-b border-line-soft py-5 last:border-b-0 sm:grid-cols-[88px_minmax(0,1fr)] ${r.urgent ? "-mx-5 border-l-4 border-l-hot bg-hot-soft pl-4 pr-5 lg:-mx-7 lg:pl-6 lg:pr-7" : ""}`}
          >
            <div className="flex items-center gap-3 sm:block">
              <span className="mono block text-[12.5px] text-ink-3">{r.time}</span>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-4 sm:mt-1.5">
                <span className={`size-1.5 rounded-full ${r.urgent ? "bg-hot" : KIND_DOT[r.kind]}`} aria-hidden="true" />
                {r.kind}
              </span>
            </div>
            <article className={`min-w-0 sm:border-l sm:pl-8 ${r.urgent ? "sm:border-hot/40" : "sm:border-line"}`}>
              {r.urgent && <span className="mb-2 inline-flex rounded-full bg-hot px-2.5 py-0.5 text-[12px] font-semibold text-white">重要</span>}
              <h3 className={`text-[15px] font-bold leading-snug ${r.urgent ? "text-hot" : "text-ink"}`}>{r.title}</h3>
              <ReleaseBody lines={r.body} />
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Draws a major release: its `feature`, whose shape is the site's. */
type FeatureDrawing = ComponentType<{ release: Release; id?: string }>;

/** The site's drawing (site/changelog/FeatureRelease.tsx), when it ships one. */
const SITE_FEATURE = Object.values(import.meta.glob<FeatureDrawing>("../../../../../site/changelog/FeatureRelease.tsx", { eager: true, import: "FeatureRelease" }))[0];

/**
 * A date with a major release: each release's `feature` is drawn as its own block by the site's drawing,
 * the first one carrying the date's anchor, above a card of the date's other releases; `body` stays the
 * short form.
 */
function FeatureDay({ date, releases, Drawing, anchors }: { date: string; releases: Release[]; Drawing: FeatureDrawing; anchors: boolean }) {
  const features = releases.filter((r) => r.feature);
  const plain = releases.filter((r) => !r.feature);
  return (
    <>
      {features.map((r, i) => (
        <Drawing key={`${r.date}-${r.time}`} release={r} id={anchors && i === 0 ? `d-${date}` : undefined} />
      ))}
      {plain.length > 0 && <Day date={date} releases={plain} />}
    </>
  );
}

export function ChangelogEntries({ releases, anchors = true }: { releases: ChangelogRelease[]; anchors?: boolean }) {
  const groups = new Map<string, Release[]>();
  for (const r of releases) groups.set(r.date, [...(groups.get(r.date) ?? []), r]);

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([date, dayReleases]) => {
        if (SITE_FEATURE && dayReleases.some((r) => r.feature)) {
          return <FeatureDay key={date} date={date} releases={dayReleases} Drawing={SITE_FEATURE} anchors={anchors} />;
        }
        return <Day key={date} id={anchors ? `d-${date}` : undefined} date={date} releases={dayReleases} />;
      })}
    </div>
  );
}
