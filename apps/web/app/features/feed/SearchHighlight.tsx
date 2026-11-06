import {Fragment} from 'react';
import {matchRanges,searchWords} from '@agidawn/contracts/search';

export function SearchHighlight({text,query}:{text:string;query?:string}){
  const ranges=matchRanges(text,searchWords(query??'').slice(0,6));let end=0;
  return <>{ranges.map((range,index)=>{const prefix=text.slice(end,range.start);end=range.end;return <Fragment key={index}>{prefix}<mark>{text.slice(range.start,range.end)}</mark></Fragment>;})}{text.slice(end)}</>;
}
