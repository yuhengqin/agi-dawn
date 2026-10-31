/** Literal metadata inside Markdown; note bodies themselves retain their saved Markdown. */
export const markdownText=(value:string)=>value.replace(/[\r\n]+/g," ").replace(/[\\`*_{}\[\]()#+.!<>|~\-]/g,"\\$&");
