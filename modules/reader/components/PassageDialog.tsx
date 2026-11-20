import {useId,useLayoutEffect,useRef,type ReactNode,type RefObject} from 'react';
import {IconClose} from '../../../apps/web/app/components/icons.tsx';

export default function PassageDialog({title,onClose,returnTo,children}:{title:string;onClose:()=>void;returnTo:RefObject<HTMLElement|null>;children:ReactNode}){
  const dialog=useRef<HTMLDialogElement>(null),id=useId();
  useLayoutEffect(()=>{
    const element=dialog.current!,opener=document.activeElement;
    element.showModal();
    element.querySelector<HTMLElement>('[data-initial-focus]')?.focus({preventScroll:true});
    return ()=>{
      element.close();
      const target=opener instanceof HTMLElement&&opener!==document.body&&opener.isConnected?opener:returnTo.current;
      target?.focus({preventScroll:true});
    };
  },[returnTo]);
  return <dialog ref={dialog} aria-labelledby={id} aria-modal="true" className="passage-dialog"
    onCancel={event=>{event.preventDefault();onClose();}}
    onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)onClose();}}}>
    <header><h2 id={id}>{title}</h2><button type="button" className="passage-close" aria-label="关闭" onClick={onClose}><IconClose/></button></header>
    {children}
  </dialog>;
}
