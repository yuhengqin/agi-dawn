import type {ContentDocument} from '../components.ts';

/** These are article illustrations; Readability's negative “media” weight is inappropriate here. */
export function adaptAnthropic(document:ContentDocument):void{
  for(const column of document.querySelectorAll('[class*="_media-column"]')){
    if(column.querySelector('img,picture,pre,table,[role="table"]'))column.removeAttribute('class');
  }
}
