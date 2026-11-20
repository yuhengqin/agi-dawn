import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {ArticlePassages} from '@agidawn/web/modules';
import {IconMessage,IconShare} from '../../../apps/web/app/components/icons.tsx';
import {ownerRequest,OwnerRequestError} from '../client.ts';
import {annotationColors,annotationNoteLimit,annotationQuoteLimit,type AnnotationColor,type Passage,type PassageAnnotation} from '../contracts.ts';
import PassageDialog from './PassageDialog.tsx';
import PassageShare from './PassageShare.tsx';
import {passageUrl} from './passage-text.ts';
import {usePassageSelection,usePassageToolbar} from './usePassageSelection.ts';
import './passages.css';

const colors:Record<AnnotationColor,string>={yellow:'黄色马克笔',pink:'粉色下划线',blue:'蓝色下划线',ink:'墨色下划线'};
const empty:PassageAnnotation[]=[];
interface Editor {
  passage:Passage; bodyKey:string; mark?:PassageAnnotation; color:AnnotationColor; draft:string;
  error?:string; compare?:string; review?:boolean;
}
type Panel={kind:'note'|'delete';editor:Editor}|{kind:'share';passage:Passage}|{kind:'login'};
type Props=ArticlePassages&{base:string;owner:boolean;checking:boolean;onDirtyChange:(dirty:boolean)=>void};
const expired=(err:unknown)=>err instanceof OwnerRequestError&&err.status===401;

export default function PassageTools({body,bodyKey,title,credit,base,owner,checking,onDirtyChange}:Props){
  const [marks,setMarks]=useState<PassageAnnotation[]>(empty),[loading,setLoading]=useState(owner),[loadError,setLoadError]=useState(false);
  const [panel,setPanel]=useState<Panel|null>(null),[busy,setBusy]=useState(false);
  const [color,setColor]=useState<AnnotationColor>('yellow');
  const alive=useRef(true),working=useRef(false);
  const visible=owner&&!checking?marks:empty;
  const {pick,clear,toolbar,linkMessage,noteAnchors}=usePassageSelection(body,bodyKey,visible,!!panel||busy);
  const showBar=!!pick&&!panel;
  usePassageToolbar(toolbar,pick,showBar);
  const read=(signal?:AbortSignal)=>ownerRequest<{items:PassageAnnotation[]}>(base,'GET',undefined,{signal});
  useEffect(()=>{
    alive.current=true;
    const abort=new AbortController();
    if(owner)read(abort.signal).then(({items})=>{if(!abort.signal.aborted)setMarks(items);})
      .catch(err=>{if(!abort.signal.aborted&&!expired(err))setLoadError(true);})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return ()=>{alive.current=false;abort.abort();};
  },[base,owner]);
  const close=()=>{if(!working.current){setPanel(null);clear();}};
  const editorFor=(passage:Passage,mark?:PassageAnnotation):Editor=>({
    passage,bodyKey:mark?.bodyKey??bodyKey,mark,color:mark?.color??color,draft:mark?.note??'',
  });
  const write=async(editor:Editor,operation:'save'|'delete')=>{
    if(!owner){setPanel({kind:'login'});return;}
    if(working.current)return;
    if(editor.passage.quote.length>annotationQuoteLimit){
      setPanel({kind:'note',editor:{...editor,error:'这段选文太长，请缩短到 20,000 字符以内。'}});return;
    }
    const {mark}=editor;
    working.current=true;setBusy(true);
    try{
      if(operation==='delete'){
        if(!mark)return;
        await ownerRequest(base+'/'+mark.id,'DELETE',{expectedVersion:mark.version});
        if(alive.current)setMarks(items=>items.filter(item=>item.id!==mark.id));
      }else{
        const fields={color:editor.color,note:editor.draft};
        const next=mark
          ?await ownerRequest<PassageAnnotation>(base+'/'+mark.id,'PATCH',{...fields,expectedVersion:mark.version})
          :await ownerRequest<PassageAnnotation>(base,'POST',{start:editor.passage.start,end:editor.passage.end,quote:editor.passage.quote,bodyKey:editor.bodyKey,...fields});
        if(alive.current){
          setMarks(items=>[...items.filter(item=>item.id!==next.id),next]);setColor(next.color);
        }
      }
      if(alive.current){setPanel(null);clear();}
    }catch(err){
      if(alive.current&&!expired(err)){
        const conflict=err instanceof OwnerRequestError&&err.status===409;
        const error=conflict?'这条划线已在另一窗口变更，请重新载入核对。':'请求未确认，请重新载入核对已保存的内容。';
        setPanel({kind:operation==='delete'?'delete':'note',editor:{...editor,error,review:true}});
      }
    }finally{working.current=false;if(alive.current)setBusy(false);}
  };
  const reload=async()=>{
    if(working.current)return;
    working.current=true;setBusy(true);
    try{
      const {items}=await read();if(!alive.current)return;
      setMarks(items);setLoadError(false);
      if(panel?.kind==='note'||panel?.kind==='delete'){
        const editor=panel.editor;
        const mark=items.find(m=>m.bodyKey===editor.bodyKey&&m.start===editor.passage.start&&m.end===editor.passage.end&&m.quote===editor.passage.quote);
        if(panel.kind==='delete'&&!mark){setPanel(null);clear();return;}
        setPanel({...panel,editor:{...editor,mark,review:false,error:undefined,
          color:mark&&editor.color===(editor.mark?.color??color)?mark.color:editor.color,
          draft:mark&&editor.draft===(editor.mark?.note??'')?mark.note:editor.draft,
          compare:mark?(mark.note||'尚无笔记'):'这段选文目前没有划线。'}});
      }
    }catch(err){if(alive.current&&!expired(err)){
      if(panel?.kind==='note'||panel?.kind==='delete')setPanel({...panel,editor:{...panel.editor,error:'暂时无法载入，请重试。'}});
      else setLoadError(true);
    }}finally{working.current=false;if(alive.current)setBusy(false);}
  };
  const saveColor=(chosen:AnnotationColor)=>{
    if(pick)void write({...editorFor(pick.passage,pick.mark),color:chosen},'save');
  };
  const openNote=(passage:Passage,mark?:PassageAnnotation)=>setPanel(owner
    ?{kind:'note',editor:editorFor(passage,mark)}:{kind:'login'});
  const privatePanel=panel?.kind==='note'||panel?.kind==='delete'?panel:null;
  const edit=privatePanel?.editor;
  const dirty=!!edit&&edit.draft!==(edit.mark?.note??'');
  useEffect(()=>{onDirtyChange(dirty);return ()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  const disabled=busy||checking||loading;
  return <>
    {noteAnchors.map(({id,host})=>{
      const mark=visible.find(item=>item.id===id);
      return mark&&createPortal(<button type="button" className="passage-note-marker" data-color={mark.color}
        aria-label={'查看选区笔记：'+mark.quote.slice(0,32)} title="查看选区笔记" onClick={()=>openNote(mark,mark)}><IconMessage size={14}/></button>,host,id);
    })}
    {linkMessage&&<p className="passage-hint" role="status">{linkMessage}</p>}
    {showBar&&pick&&createPortal(<div ref={toolbar} role="group" aria-label="选中文字操作" className="passage-tools" data-reading-controls
      onMouseDown={event=>event.preventDefault()}
      onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node)&&!panel)clear();}}>
      {!pick.mark&&<button type="button" disabled={disabled} onClick={()=>saveColor(color)}>划线</button>}
      {owner&&!checking&&<div className="passage-swatches">{annotationColors.map(c=>
        <button key={c} type="button" className="passage-swatch" data-color={c} title={colors[c]} aria-label={colors[c]}
          aria-pressed={pick.mark?.color===c} disabled={disabled} onClick={()=>saveColor(c)}><i/></button>)}</div>}
      <button type="button" disabled={disabled} onClick={()=>openNote(pick.passage,pick.mark)}><IconMessage size={15}/>笔记</button>
      <button type="button" disabled={busy} onClick={()=>setPanel({kind:'share',passage:pick.passage})}><IconShare size={15}/>分享</button>
      {pick.mark&&owner&&!checking&&<button type="button" disabled={disabled} onClick={()=>setPanel({kind:'delete',editor:editorFor(pick.passage,pick.mark)})}>删除</button>}
    </div>,document.body)}
    {visible.length>0&&<details className="passage-list" data-reading-controls>
      <summary>本文划线与笔记（{visible.length}）</summary><ul>{visible.map(mark=>
        <li key={mark.id}><button type="button" onClick={()=>openNote(mark,mark)}><i data-color={mark.color}/>
          <span>{mark.quote}</span>{mark.note&&<IconMessage size={15}/>}
          {mark.bodyKey!==bodyKey&&<small>早前版本</small>}</button></li>)}</ul>
    </details>}
    {owner&&!checking&&loadError&&<p className="passage-hint">私人划线暂时无法载入。 <button type="button" disabled={busy} onClick={()=>void reload()}>重新载入</button></p>}
    {panel?.kind==='login'&&<PassageDialog title="保存到私人阅读" returnTo={body} onClose={close}>
      <div className="passage-panel"><p>登录管理员账号后，回到本页即可保存划线和笔记。</p>
        <div className="passage-actions"><a className="primary" href="/admin/login" target="_blank" rel="noreferrer">在新标签页登录</a></div></div>
    </PassageDialog>}
    {panel?.kind==='share'&&<PassageDialog title="分享这段文字" returnTo={body} onClose={close}>
      <PassageShare quote={panel.passage.quote} title={title} credit={credit} url={passageUrl(bodyKey,panel.passage)}/>
    </PassageDialog>}
    {privatePanel&&edit&&owner&&!checking&&<PassageDialog title={privatePanel.kind==='delete'?'删除划线':'选区笔记'} returnTo={body} onClose={close}>
      <div className="passage-panel"><blockquote>{edit.passage.quote}</blockquote>
        {privatePanel.kind==='note'?<>
          <label className="passage-field">笔记内容<textarea data-initial-focus maxLength={annotationNoteLimit} value={edit.draft} disabled={busy}
            onChange={event=>setPanel({...privatePanel,editor:{...edit,draft:event.target.value}})}/></label>
          <p className="passage-counter">{edit.draft.length} / {annotationNoteLimit}</p></>
        :<p>{edit.mark?.note?'删除后，这段划线及其笔记将一并移除。':'删除这段文字上的划线？'}</p>}
        {edit.error&&<p role="alert">{edit.error} {edit.review&&<button type="button" className="passage-reload" disabled={busy} onClick={()=>void reload()}>重新载入</button>}</p>}
        {edit.compare!==undefined&&<div className="passage-compare"><h3>服务端已保存内容{edit.mark&&' · '+colors[edit.mark.color]}</h3><p>{edit.compare}</p></div>}
        <div className="passage-actions">
          {privatePanel.kind==='note'&&edit.mark&&<button type="button" className="passage-remove" disabled={busy} onClick={()=>setPanel({kind:'delete',editor:edit})}>删除划线</button>}
          <button type="button" disabled={busy} onClick={close}>取消</button>
          <button type="button" className="primary" disabled={busy||edit.review} onClick={()=>void write(edit,privatePanel.kind==='delete'?'delete':'save')}>
            {privatePanel.kind==='delete'?'确认删除':'保存笔记'}</button>
        </div>
      </div>
    </PassageDialog>}
  </>;
}
