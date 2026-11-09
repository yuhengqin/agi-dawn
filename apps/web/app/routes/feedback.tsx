import { useSearchParams } from "react-router";
import { SITE } from "@agidawn/site";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { ReadingLayout } from "../components/ui/Page";
import { FeedbackAside, FeedbackForm } from "../features/feedback/FeedbackForm";
import { edgeTtl } from "../lib/api.server";
import { pageMeta } from "../lib/seo";

export const handle: Screen = { tab: "me", name: "反馈" };

export function headers() {
  return edgeTtl(300);
}

export function meta() {
  return pageMeta({ title: "反馈", description: `告诉 ${SITE.name} 哪里可以做得更好：内容、功能、接入或来源方的更正与下架请求。`, path: "/feedback", image: "/og/pages/feedback.png", noindex: true });
}

export default function FeedbackPage() {
  const [params] = useSearchParams();
  return <>
    <PhoneBar back={{ to: "/more", label: "我的" }} title="意见反馈" />
    <ReadingLayout aside={<FeedbackAside />}>
      <FeedbackForm from={params.get("from") ?? ""} />
    </ReadingLayout>
  </>;
}
