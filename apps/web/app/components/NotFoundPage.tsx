import {Link,useNavigation} from 'react-router';
import {useEffect,useState,type MouseEvent} from 'react';
import {SITE} from '@agidawn/site';
import {IconSearch} from './icons';
import './NotFoundPage.css';

const IDLE_SECONDS=8;

export function NotFoundPage(){
  const navigation=useNavigation();
  const [autoReturn,setAutoReturn]=useState(true),[remaining,setRemaining]=useState<number|null>(null);
  useEffect(()=>{
    if(!autoReturn||navigation.state!=='idle')return;
    let timer:number|undefined,deadline=0;
    const update=()=>{
      timer=undefined;
      if(document.visibilityState!=='visible')return;
      const delay=deadline-performance.now();
      setRemaining(Math.max(0,Math.ceil(delay/1000)));
      if(delay<=0){window.location.replace('/');return;}
      timer=window.setTimeout(update,Math.min(1000,delay));
    };
    const reset=()=>{
      window.clearTimeout(timer);timer=undefined;
      deadline=performance.now()+IDLE_SECONDS*1000;setRemaining(IDLE_SECONDS);
      if(document.visibilityState==='visible')timer=window.setTimeout(update,1000);
    };
    const events=['pointermove','pointerdown','keydown','input','scroll','wheel','focusin','click'] as const;
    for(const event of events)window.addEventListener(event,reset,{capture:true,passive:true});
    document.addEventListener('visibilitychange',reset);reset();
    return()=>{
      window.clearTimeout(timer);
      for(const event of events)window.removeEventListener(event,reset,true);
      document.removeEventListener('visibilitychange',reset);
    };
  },[autoReturn,navigation.state]);
  const leave=(event:MouseEvent<HTMLAnchorElement>)=>{
    if(!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey)setAutoReturn(false);
  };
  return <div className="not-found-page">
    <div className="not-found-content">
      <div className="not-found-graphic" aria-hidden="true">
        {['4','0','4'].map((digit,index)=><div className="not-found-clip" key={index}>
          <div className="not-found-shadow"><span className="not-found-digit">{digit}</span></div>
        </div>)}
      </div>
      <h1>糟糕！找不到这个页面！</h1>
      <div className="not-found-description">
        <p>链接可能已失效，或对应内容已下架。</p>
        <p>你可以浏览全部文章，或按主题继续查找相关内容。</p>
      </div>
      <form role="search" aria-label="站内文章搜索" action="/" method="get" className="not-found-search" onSubmit={()=>setAutoReturn(false)}>
        <label htmlFor="not-found-query" className="sr-only">搜索文章</label>
        <input id="not-found-query" type="search" name="q" maxLength={200} placeholder="搜索文章标题或关键词" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"/>
        <button type="submit" aria-label="搜索" title="搜索"><IconSearch size={20}/></button>
      </form>
      <div className="not-found-actions">
        <Link reloadDocument to="/" onClick={leave} className="not-found-button"><span>浏览全部文章</span></Link>
        <Link reloadDocument to="/explore" onClick={leave} className="not-found-button not-found-button-secondary"><span>探索主题</span></Link>
      </div>
      <div className="not-found-redirect">
        {!autoReturn?<p role="status">已取消自动跳转。</p>:navigation.state==='idle'&&remaining!==null&&<>
          <p role="timer" aria-live="off">无操作 {remaining} 秒后自动返回首页</p>
          <button type="button" onClick={()=>setAutoReturn(false)}>取消自动跳转</button>
        </>}
      </div>
      {SITE.contactEmail&&<p className="not-found-contact">如果您认为这是我们的错误，请<a href={`mailto:${SITE.contactEmail}`}>给我们发邮件</a>。</p>}
    </div>
  </div>;
}
