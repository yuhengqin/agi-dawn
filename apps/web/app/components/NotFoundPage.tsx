import {Link} from 'react-router';
import {SITE} from '@agidawn/site';
import {IconSearch} from './icons';
import './NotFoundPage.css';

export function NotFoundPage(){
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
      <form role="search" aria-label="站内文章搜索" action="/" method="get" className="not-found-search">
        <label htmlFor="not-found-query" className="sr-only">搜索文章</label>
        <input id="not-found-query" type="search" name="q" maxLength={200} placeholder="搜索文章标题或关键词" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"/>
        <button type="submit" aria-label="搜索" title="搜索"><IconSearch size={20}/></button>
      </form>
      <div className="not-found-actions">
        <Link reloadDocument to="/" className="not-found-button"><span>浏览全部文章</span></Link>
        <Link reloadDocument to="/explore" className="not-found-button not-found-button-secondary"><span>探索主题</span></Link>
      </div>
      {SITE.contactEmail&&<p className="not-found-contact">如果您认为这是我们的错误，请<a href={`mailto:${SITE.contactEmail}`}>给我们发邮件</a>。</p>}
    </div>
  </div>;
}
