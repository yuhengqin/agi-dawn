import {sql,type Db} from '@agidawn/backend/db';
import {z} from 'zod';
import {zipSync,strToU8} from 'fflate';
import {listCategories} from '@agidawn/backend/publication/categories';
import {listTopics} from '@agidawn/backend/publication/topics';
import {readArticleClassification} from './classification.ts';
import {readNote} from './notes.ts';
import {missing,readState} from './state.ts';
import {markdownText} from './markdown.ts';

async function readNoteFile(articleId:string,db:Db){
    const [article]=await db`SELECT a.id,coalesce(p.title,o.fields->>'title',a.title) AS title,coalesce(p.category,o.fields->>'category') AS category,a.url,a.author,a.published_at,a.discovered_at,s.name AS source
      FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN publications p ON p.article_id=a.id
      LEFT JOIN editorial_overrides o ON o.article_id=a.id WHERE a.id=${articleId}`;
    if(!article)throw missing();
    const classification=await readArticleClassification(articleId,db),categories=await listCategories(db),catalog=await listTopics(db);
    const state=await readState(articleId,db),note=await readNote(articleId,db);
    const category=categories.find(item=>item.id===article.category)?.name??'待分类';
    const topics=catalog.filter(item=>classification.topicSlugs.includes(item.slug)).map(item=>item.name);
    const metadata={title:article.title,article_id:articleId,source:article.source,author:article.author,original_url:article.url,
      published_at:article.published_at?.toISOString()??null,collected_at:article.discovered_at.toISOString(),category,topics,
      reading_status:state.status,starred:state.starred,note_version:note.version,note_updated_at:note.updatedAt};
    const status={'to-read':'待读',reading:'在读',read:'已读'}[state.status];
    const text='---\n'+Object.entries(metadata).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n')+'\n---\n\n'
      +'# '+markdownText(article.title)+'\n\n'
      +'来源：'+markdownText(article.source)+'  \n原文：[查看原文](<'+article.url.replace(/[<>\s\\]/g,(c:string)=>encodeURIComponent(c))+'>)  \n'
      +'分类：'+markdownText(category)+'  \n主题：'+(topics.length?topics.map(markdownText).join('、'):'无')+'  \n'
      +'阅读状态：'+status+'  \n收藏：'+(state.starred?'已收藏':'未收藏')+'\n\n'
      +'## 已保存笔记\n\n'+(note.text.trim()?note.text:'（尚无已保存笔记）')+'\n';
    return {filename:'reading-note-'+articleId.replace(/[^\w-]/g,'_')+'.md',text};
}

export async function exportNote(articleId:string){
  return sql.begin('isolation level repeatable read read only',db=>readNoteFile(articleId,db));
}

const selection=z.object({articleIds:z.array(z.string().regex(/^[\w-]{1,80}$/)).min(1).max(100)}).strict()
  .refine(value=>new Set(value.articleIds).size===value.articleIds.length,'所选文章重复，请重新选择');
export async function exportNotes(input:unknown){
  const {articleIds}=selection.parse(input);
  const files=await sql.begin('isolation level repeatable read read only',async db=>{
    const files:Record<string,Uint8Array>={};
    for(const id of articleIds){const file=await readNoteFile(id,db);files[file.filename]=strToU8(file.text);}
    return files;
  });
  return Buffer.from(zipSync(files));
}
