import mediumZoom, { type Zoom } from "medium-zoom";

interface Session {
  zoom: Zoom;
  source: HTMLImageElement;
  clone: HTMLImageElement;
  closing: boolean;
  closed: Promise<void>;
}

/** medium-zoom owns the animated copy; the viewer owns the interactive image and modal lifecycle. */
export function createImageZoom(source:HTMLImageElement,picture:HTMLImageElement,stage:HTMLElement,layer:HTMLElement,onOpened:()=>void){
  let session:Session|null=null,disposed=false,returning=false,opened=false;
  const hidden=new Map<HTMLImageElement,string>();
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveal=()=>{
    if(disposed||returning)return;
    opened=true;
    onOpened();
    if(session)session.clone.style.visibility='hidden';
  };
  const attach=(origin:HTMLImageElement,enter:boolean)=>{
    const bounds=stage.getBoundingClientRect();
    origin.classList.add('lightbox-transition-image');
    const zoom=mediumZoom(origin,{
      background:'transparent',scrollOffset:Infinity,
      container:{width:innerWidth,height:innerHeight,left:bounds.left,right:innerWidth-bounds.right,top:bounds.top,bottom:innerHeight-bounds.bottom},
    });
    let done=()=>{};
    const closed=new Promise<void>(resolve=>done=resolve);
    let record:Session;
    const onClose=()=>{record.closing=true;};
    const onClosed=()=>{
      zoom.off('close',onClose);
      zoom.off('closed',onClosed);
      origin.classList.remove('lightbox-transition-image');
      zoom.detach();
      if(session===record)session=null;
      done();
      if(!opened)reveal();
    };
    zoom.on('close',onClose);
    zoom.on('closed',onClosed);
    const pending=zoom.open();
    // The library creates its copy synchronously. Scope it to our marker, then put it inside the modal.
    const clone=document.querySelector<HTMLImageElement>('.lightbox-transition-image.medium-zoom-image--opened')!;
    const originBox=origin.getBoundingClientRect();
    Object.assign(clone.style,{position:'fixed',top:`${originBox.top}px`,left:`${originBox.left}px`});
    clone.removeAttribute('role');clone.removeAttribute('tabindex');clone.removeAttribute('aria-label');
    clone.setAttribute('aria-hidden','true');clone.alt='';
    layer.append(clone);
    record={zoom,source:origin,clone,closing:false,closed};
    session=record;
    if(enter){
      // Reparenting cancels a CSS transition. Establish the original frame inside the modal before continuing it.
      const destination=clone.style.transform;
      clone.style.setProperty('transition','none','important');
      clone.style.transform='none';
      clone.getBoundingClientRect();
      requestAnimationFrame(()=>{
        if(disposed||returning||record.closing)return;
        clone.style.removeProperty('transition');
        clone.style.transform=destination;
      });
      void pending.then(()=>{if(!record.closing)reveal();});
    }
    return record;
  };
  const dispose=()=>{
    disposed=true;
    for(const [image,visibility] of hidden)image.style.visibility=visibility;
    hidden.clear();
    if(session){
      session.clone.style.visibility='hidden';
      session.clone.style.setProperty('transition','none','important');
      void session.zoom.close();
    }
  };
  if(reduced())reveal();else attach(source,true);

  return {
    dispose,
    async close(current:HTMLImageElement,currentPicture:HTMLImageElement){
      if(disposed||returning)return;
      returning=true;
      // An interrupted entrance returns from the in-flight frame, not the fully expanded image.
      const inFlight=!opened&&session&&!session.closing;
      const from=(inFlight?session!.clone:currentPicture).getBoundingClientRect();
      const target=current.getBoundingClientRect();
      if(reduced()){dispose();return;}
      if(!current.isConnected||!target.width||!target.height||target.bottom<=0||target.top>=innerHeight||target.right<=0||target.left>=innerWidth){
        const visual=inFlight?session!.clone:currentPicture;
        await visual.animate([{opacity:1},{opacity:0}],{duration:300,easing:'ease-out',fill:'forwards'}).finished.catch(()=>{});
        dispose();return;
      }
      // A resize may already be closing the library's hidden copy; the interactive viewer stays open.
      if(session?.closing)await session.closed;
      if(disposed)return;
      const active=session??attach(current,false),clone=active.clone;
      const sx=from.width/target.width,sy=from.height/target.height;
      clone.src=currentPicture.currentSrc||currentPicture.src;
      clone.style.setProperty('transition','none','important');
      Object.assign(clone.style,{
        visibility:'visible',left:`${target.left}px`,top:`${target.top}px`,width:`${target.width}px`,height:`${target.height}px`,
        transform:`translate(${from.left-target.left+(from.width-target.width)/2}px, ${from.top-target.top+(from.height-target.height)/2}px) scale(${sx}, ${sy})`,
      });
      const viewport=stage.getBoundingClientRect();
      clone.style.clipPath=inFlight?'inset(0px)':`inset(${Math.max(0,viewport.top-from.top)/sy}px ${Math.max(0,from.right-viewport.right)/sx}px ${Math.max(0,from.bottom-viewport.bottom)/sy}px ${Math.max(0,viewport.left-from.left)/sx}px)`;
      if(current!==active.source){
        active.source.classList.remove('medium-zoom-image--hidden');
        hidden.set(current,current.style.visibility);current.style.visibility='hidden';
      }
      currentPicture.style.visibility='hidden';
      clone.getBoundingClientRect();
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if(disposed)return;
      clone.style.removeProperty('transition');
      clone.style.clipPath='inset(0px)';
      await active.zoom.close();
      await active.closed;
      dispose();
      currentPicture.style.removeProperty('visibility');
    },
  };
}
