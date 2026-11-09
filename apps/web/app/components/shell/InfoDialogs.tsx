import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { SITE } from "@agidawn/site";
import type { ChangelogResponse } from "@agidawn/contracts/site";
import { setChangelogSeen } from "../../lib/local-state";
import { IconClose } from "../icons";
import { AboutContent } from "./AboutContent";
import { InfoDialogContext, type InfoPath } from "./InfoLink";

const FeedbackForm = lazy(() => import("../../features/feedback/FeedbackForm").then(module => ({ default: module.FeedbackForm })));
const ChangelogEntries = lazy(() => import("../../features/changelog/ChangelogEntries").then(module => ({ default: module.ChangelogEntries })));

const pages = {
  "/about": { title: `关于 ${SITE.name}`, width: "max-w-[560px]" },
  "/changelog": { title: "更新日志", width: "max-w-[680px]" },
  "/feedback": { title: "反馈", width: "max-w-[620px]" },
} satisfies Record<InfoPath, { title: string; width: string }>;

function Loading() {
  return <p role="status" className="py-5 text-sm text-ink-3">正在加载…</p>;
}

function ChangelogPanel() {
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<ChangelogResponse | null | false>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/site/changelog", { signal: controller.signal });
        if (!response.ok) throw new Error("Changelog unavailable");
        const result: ChangelogResponse = await response.json();
        if (!Array.isArray(result.releases) || typeof result.latestVersion !== "string") throw new Error("Invalid changelog");
        if (!controller.signal.aborted) setData(result);
      } catch {
        if (!controller.signal.aborted) setData(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  if (data === null) return <Loading />;
  if (!data) return <div className="space-y-3 py-3 text-sm">
    <p role="alert" className="text-ink-3">暂时无法加载更新日志。</p>
    <button type="button" onClick={() => { setData(null); setAttempt(value => value + 1); }}
      className="min-h-9 rounded-control border border-line px-3 text-accent hover:bg-bg-sunk">重试</button>
  </div>;
  return <LoadedChangelog data={data} />;
}

function LoadedChangelog({ data }: { data: ChangelogResponse }) {
  // This component commits only when the release list is ready to display.
  useEffect(() => setChangelogSeen(data.latestVersion), [data.latestVersion]);
  return data.releases.length
    ? <ChangelogEntries releases={data.releases} anchors={false} />
    : <p className="py-5 text-sm text-ink-3">暂无更新记录。</p>;
}

export function InfoDialogs({ children }: { children: ReactNode }) {
  const { key } = useLocation();
  const [active, setActive] = useState<InfoPath | null>(null);
  const [feedback, setFeedback] = useState<{ from: string; done: boolean } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const outsidePress = useRef(false);
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const close = () => {
    if (active === "/feedback" && feedback?.done) setFeedback(null);
    setActive(null);
  };

  useEffect(() => {
    setActive(null);
    setFeedback(null);
  }, [key]);
  useLayoutEffect(() => {
    const element = dialog.current!;
    if (!active) {
      if (element.open) {
        element.close();
        if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      }
      return;
    }
    if (!element.open) element.showModal();
    body.current?.scrollTo(0, 0);
    title.current?.focus({ preventScroll: true });
  }, [active]);

  const page = active && pages[active];
  return <InfoDialogContext.Provider value={(path, element) => {
    if (!active) opener.current = element;
    if (path === "/feedback" && !feedback) setFeedback({ from: window.location.href, done: false });
    setActive(path);
  }}>
    {children}
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`fixed inset-0 m-auto max-h-[calc(100dvh-2.5rem)] w-[calc(100%-2.5rem)] ${page?.width ?? ""} flex-col overflow-hidden overscroll-contain rounded-sheet border border-line bg-surface text-ink shadow-[var(--shadow-soft)] open:flex backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/40`}
      onCancel={event => { event.preventDefault(); close(); }}
      onPointerDown={event => { outsidePress.current = event.target === event.currentTarget; }}
      onClick={event => {
        if (outsidePress.current && event.target === event.currentTarget) close();
        outsidePress.current = false;
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-2.5">
        <h2 id={titleId} ref={title} tabIndex={-1} className="text-lg font-semibold outline-none">{page?.title}</h2>
        <button type="button" onClick={close} aria-label="关闭"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-control text-ink-3 hover:bg-bg-sunk hover:text-ink">
          <IconClose size={18} />
        </button>
      </header>
      <div ref={body} className="scrollbar-thin min-h-0 overflow-y-auto overscroll-contain p-5">
        {active === "/about" && <AboutContent compact />}
        {active === "/changelog" && <Suspense fallback={<Loading />}><ChangelogPanel /></Suspense>}
        {feedback && <div hidden={active !== "/feedback"}>
          <Suspense fallback={<Loading />}>
            <FeedbackForm from={feedback.from} visible={active === "/feedback"} onClose={close}
              onSubmitted={() => setFeedback(value => value && { ...value, done: true })} />
          </Suspense>
        </div>}
      </div>
    </dialog>
  </InfoDialogContext.Provider>;
}
