import type {Founder} from "@agidawn/contracts/site-config";

export const SITE={
  name:"AGI黎明",subject:"AI",homeTitle:"AGI黎明 — 技术文章阅读与归档",exploreTitle:"探索",
  feedbackExample:"例如：我在搜索某个关键词时遇到……我原本想……",feedbackLead:"内容或功能有问题，可以在这里反馈。",feedbackEmailHint:"留下邮箱，便于回复",
  description:"从关注的技术博客收录文章，按来源、主题和时间查找，保存阅读进度与文章版本。",tagline:"技术文章阅读与归档",
  keywords:["技术文章","工程博客","文章归档"] as string[],since:null as string|null,locale:"zh-CN",defaultUrl:"http://localhost:3000",
  rootIcons:[] as string[],contactEmail:null as string|null,footerNote:null as string|null,icp:null as string|null,psb:null as string|null,github:null as string|null,
  organization:{name:"AGI黎明",founder:null as Founder|null},crawlerName:"AGIDawnReader/1.0",
} as const;

export const POLICY={
  terms:{name:"使用规则",description:"本站文章索引、阅读与私人归档的使用说明。",headers:null as Record<string,string>|null},
  privacy:{description:"本站如何处理管理员私人阅读资料、浏览器偏好、反馈与访问日志。"},
} as const;

interface ContactCard {kind:string;title:string;note:string;alias?:string}
export const ABOUT={
  kicker:`关于 ${SITE.name}`,description:`关于 ${SITE.name}：${SITE.description}`,headline:["技术文章，","集中阅读与保存。"] as [string,string],
  lead:`${SITE.name} 收录关注来源的文章，提供检索、阅读与私人归档。无需读者账号。`,
  steps:{collect:"来源更新后收录标题、摘要与原文链接。",store:"按发布时间排列；缺少时间时明确标注收录时间。",select:"按来源、主题和日期查找，分类由站主逐步整理。",publish:"站主登录后保存收藏、阅读进度、笔记与文章版本。"},
  maker:null as null|{name:string;greeting:string[];wechat?:ContactCard;feishu?:ContactCard},
  copyright:[`${SITE.name} 提供文章索引与阅读，原文版权归各来源所有。来源方如需更正、下架或调整展示方式，可以通过`,"联系我们。"] as [string,string],
  termsAnchor:null as string|null,
} as const;
export const ADMIN={feedbackNote:null as string|null,banNote:null as string|null,budgetNote:null as string|null};
export const ALERTS={quietMinutes:360,usualFlow:null as string|null,workerLogs:"看 worker 的日志（docker compose logs worker）"};
export const SOURCE_DEFAULTS={siteFulltext:false};
// Homepage shortcuts; unlisted categories keep their stored order after these entries.
export const ARTICLE_NAVIGATION={
  categoryOrder:['智能体工程','AI 编程','产品与应用','评测与安全','系统与性能','观点与方法','待分类'] as string[],
  topicShortcuts:['harness-long-running','mcp-tool-use','skills-extensions'] as string[],
};
export const CARDS:Record<string,{kicker:string;title:string;subtitle:string;accent?:"hot"|"amber"}>={
  site:{kicker:SITE.name,title:SITE.tagline,subtitle:SITE.description},
  explore:{kicker:"文章",title:"探索",subtitle:"按技术主题或内容来源发现文章，查看最新收录与更新。"},
  about:{kicker:"关于",title:`关于 ${SITE.name}`,subtitle:SITE.description},
  terms:{kicker:"使用规则",title:`${SITE.name} 使用规则`,subtitle:POLICY.terms.description},
  privacy:{kicker:"隐私说明",title:`${SITE.name} 隐私说明`,subtitle:POLICY.privacy.description},
  changelog:{kicker:"更新日志",title:`${SITE.name} 更新日志`,subtitle:"功能更新与变更记录。"},
  feedback:{kicker:"反馈",title:"内容或功能有问题",subtitle:"提交问题、修正和来源方下架请求。"},
};
export const DEPLOYMENT={
  credentialsDir:null as string|null,credentialFiles:{} as Partial<Record<string,string>>,requiredSecrets:[] as const,
  originHost:null as string|null,loginReturnHeader:null as string|null,
  imageUpstreamBudget:null as null|{mbPerMinute:number;gbPerDay:number},directFetchHosts:[] as string[],
  curlFetch:{hosts:["openai.com"] as string[],intervalMs:15_000},
};
