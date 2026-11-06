import {useMemo} from 'react';
import {useNavigation} from 'react-router';

/** Compose the next action with the latest requested filters, not the still-visible results. */
export function useReaderQuery(query:Record<string,string>){
  const {location}=useNavigation();
  return useMemo(()=>location?.pathname==='/'?Object.fromEntries(new URLSearchParams(location.search)):query,[location,query]);
}
