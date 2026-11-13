import {componentText,replaceComponent,type ContentDocument} from '../components.ts';

/** A rich outbound card must not outscore and replace the author's surrounding commentary. */
export function adaptGhost(document:ContentDocument):void{
  for(const card of document.querySelectorAll('.gh-content .kg-bookmark-card')){
    const quote=document.createElement('blockquote'),link=card.querySelector('a[href]'),title=card.querySelector('.kg-bookmark-title');
    if(!link||!title)continue;
    const head=document.createElement('p'),anchor=document.createElement('a');
    anchor.setAttribute('href',link.getAttribute('href')!);anchor.textContent=componentText(title);head.append(anchor);quote.append(head);
    for(const selector of ['.kg-bookmark-description','.kg-bookmark-metadata','figcaption']){
      const text=componentText(card.querySelector(selector)).replace(/^Geoffrey HuntleyGeoffrey Huntley$/,'Geoffrey Huntley').replace(/&#(?:0*39|x0*27);/gi,"'");if(text){const p=document.createElement('p');p.textContent=text;quote.append(p);}
    }
    for(const image of card.querySelectorAll('.kg-bookmark-thumbnail img'))quote.append(image.cloneNode(true));
    replaceComponent(card,quote);
  }
}
