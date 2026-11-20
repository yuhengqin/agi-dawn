import {useEffect,useRef,useState} from 'react';
import {copyText} from '../../../apps/web/app/lib/clipboard.ts';
import {IconCopy,IconDownload,IconImage} from '../../../apps/web/app/components/icons.tsx';

export default function PassageShare({quote,title,credit,url}:{quote:string;title:string;credit:string;url:string}){
  const [image,setImage]=useState<{src:string;card:boolean;shortened?:boolean}|null>(null);
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const active=useRef(true);
  useEffect(()=>{active.current=true;return ()=>{active.current=false;};},[]);
  const text=`${quote}\n\n——《${title}》 · ${credit}\n${url}`;
  async function copy(value:string,success:string){
    setError('');
    try{await copyText(value);if(active.current)setMessage(success);}
    catch{if(active.current){setMessage('');setError('复制失败，可从下方手动复制链接。');}}
  }
  async function draw(card:boolean){
    setBusy(true);setMessage('');setError('');
    try{
      const {passageCard,passageQr}=await import('./passage-card.ts');
      const result=card?passageCard(quote,title,credit,url):{src:passageQr(url).toDataURL('image/png')};
      if(active.current)setImage({...result,card});
    }catch{if(active.current)setError('图片生成失败，请重试或复制链接。');}
    finally{if(active.current)setBusy(false);}
  }
  const local=['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
  const caption=`《${title}》 · ${credit}`;
  const filename=title.replace(/[\\/:*?"<>|]/g,'').slice(0,60)||'文章';
  return <div className="passage-panel">
    {image?<><img className={image.card?'passage-card':'passage-qr'} src={image.src} alt={image.card?'摘录分享图':'选段链接二维码'}/>
      {image.shortened&&<p className="passage-hint">图片展示节选，复制摘录可保留完整文字。</p>}
      <div className="passage-actions"><button type="button" onClick={()=>{setImage(null);setMessage('');}}>返回分享选项</button>
        {image.card&&<a className="primary" download={filename+'-摘录.png'} href={image.src}><IconDownload size={16}/>保存图片</a>}</div></>
    :<><blockquote>{quote}</blockquote><p className="passage-credit">{caption}</p>
      <div className="passage-actions">
        <button type="button" className="primary" onClick={()=>void copy(url,'链接已复制')}><IconCopy size={16}/>复制链接</button>
        <button type="button" onClick={()=>void copy(text,'摘录与出处已复制')}>复制摘录</button>
        <button type="button" disabled={busy} onClick={()=>void draw(true)}><IconImage size={16}/>分享图</button>
        <button type="button" disabled={busy} onClick={()=>void draw(false)}>微信扫码</button>
      </div>
      <div className="passage-channels">
        <a href={'https://service.weibo.com/share/share.php?'+new URLSearchParams({url,title:caption})} target="_blank" rel="noreferrer">微博</a>
        <a href={'https://connect.qq.com/widget/shareqq/index.html?'+new URLSearchParams({url,title,summary:credit})} target="_blank" rel="noreferrer">QQ</a>
        <a href={'mailto:?subject='+encodeURIComponent(title)+'&body='+encodeURIComponent(quote.slice(0,500)+'\n'+caption+'\n'+url)}>邮件</a>
      </div></>}
    {local&&<p className="passage-hint">此链接指向本机，跨设备可发送分享图。</p>}
    {busy&&<p role="status">正在生成图片…</p>}{message&&<p role="status">{message}</p>}
    {error&&<><p role="alert">{error}</p><input aria-label="选段链接" readOnly value={url} onFocus={event=>event.target.select()}/></>}
  </div>;
}
