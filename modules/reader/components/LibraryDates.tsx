import {DateRangePicker,dateRangeLabel} from "../../../apps/web/app/features/feed/ReaderDatePicker.tsx";

export default function LibraryDates({query,onApply}:{query:Record<string,string>;onApply:(changes:Record<string,string>)=>void}){
  const hiddenFields=Object.fromEntries(Object.entries(query).filter(([key])=>!["cursor","dateField","dateFrom","dateTo"].includes(key)));
  const from=query.dateFrom??"",to=query.dateTo??"";
  return <DateRangePicker from={from} to={to} action="/admin/reader" fromName="dateFrom" toName="dateTo" hiddenFields={hiddenFields}
    triggerLabel={`日期范围（${dateRangeLabel(from,to)}）`}
    basis={{name:"dateField",value:query.dateField??"collected",label:"日期依据",options:[{value:"collected",label:"收录时间"},{value:"note-updated",label:"笔记更新时间"}],description:"笔记日期只匹配有内容的已保存笔记，排序另行选择。"}}
    onApply={(dateFrom,dateTo,dateField)=>onApply({dateField:dateField??query.dateField??"collected",dateFrom,dateTo})}/>;
}
