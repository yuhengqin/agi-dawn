import {componentHidden,componentText,replaceComponent,type ContentDocument,type ContentElement} from '../components.ts';

/** Lexical image decorators precede a section even when the publisher nests them inside its heading. */
export function adaptUber(document:ContentDocument):void{
  if(!document.querySelector('meta[name="author"],meta[property="article:author"]')){
    const authors=new Set<string>();
    for(const avatar of document.querySelectorAll('main [data-baseweb="avatar"][aria-label]')){
      const name=avatar.getAttribute('aria-label')?.trim(),label=avatar.parentElement?.querySelector('[data-baseweb="typo-labelmedium"]');
      if(name&&componentText(label)===name)authors.add(name);
    }
    if(authors.size){const meta=document.createElement('meta');meta.setAttribute('name','author');meta.setAttribute('content',[...authors].join(', '));document.head?.append(meta);}
  }
  for(const heading of document.querySelectorAll('h1,h2,h3,h4,h5,h6')){
    if(componentHidden(heading))continue;
    const decorators=[...heading.children].filter(child=>child.getAttribute('data-lexical-decorator')==='true'&&child.querySelector('.rich-image-wrapper'));
    if(!decorators.length)continue;
    const title=heading.cloneNode(true) as ContentElement;
    for(const decorator of title.querySelectorAll('[data-lexical-decorator="true"]'))decorator.remove();
    if(!componentText(title))continue;
    for(const decorator of decorators){
      for(const wrapper of decorator.querySelectorAll('.rich-image-wrapper')){
        for(const caption of wrapper.querySelectorAll('.rich-image-caption')){
          const replacement=document.createElement('figcaption');replacement.append(...caption.childNodes);replaceComponent(caption,replacement);
        }
        const figure=document.createElement('figure');figure.append(...wrapper.childNodes);replaceComponent(wrapper,figure);
      }
      heading.before(decorator);
    }
  }
}
