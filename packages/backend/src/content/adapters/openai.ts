import type {ContentDocument} from '../components.ts';

/** Article tabs are alternative public case studies, not navigation or arbitrary hidden content. */
export function adaptOpenAI(document:ContentDocument):void{
  for(const arc of document.querySelectorAll('main svg[aria-hidden="true"][class*="_arc_"]'))arc.remove();
  for(const list of document.querySelectorAll('main [role="tablist"],article [role="tablist"]')){
    const tabs=[...list.querySelectorAll('[role="tab"]')];
    const panels=tabs.map(tab=>document.getElementById(tab.getAttribute('aria-controls')??''));
    if(tabs.length<2||panels.some((panel,index)=>!panel||panel.getAttribute('role')!=='tabpanel'
      ||panel.getAttribute('aria-labelledby')!==tabs[index]!.id)||new Set(panels).size!==tabs.length)continue;
    const parent=panels[0]!.parentElement;
    if(!parent||panels.some(panel=>panel!.parentElement!==parent)||!parent.closest('main,article'))continue;
    for(const panel of panels)panel!.replaceWith(...panel!.childNodes);
    list.remove();
  }
}

/** Prose slugs such as hidden/share/author are not publisher controls. Run after permalink cleanup. */
export function protectOpenAIHeadings(document:ContentDocument):void{
  for(const heading of document.querySelector('article#mainContent')?.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')??[])heading.removeAttribute('id');
}
