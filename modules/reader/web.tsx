import {defineWebModule} from "@agidawn/web/modules";
import OwnerTools from "./components/OwnerTools.tsx";
export default defineWebModule({name:"reader",articleTools:OwnerTools,admin:{landing:"/admin/reader",groups:[{group:"私人阅读",items:[{to:"/admin/reader",label:"私人书库"},{to:"/admin/reader/categories",label:"分类管理"},{to:"/admin/reader/topics",label:"主题管理"}]}]}});
