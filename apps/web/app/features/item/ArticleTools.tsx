import {IconFocus} from '../../components/icons';
import {BackToTop} from '../../components/shell/Chrome';
import {ThemeToggle} from '../../components/shell/ThemeSwitch';
import {ReadingDisplay} from './ReadingDisplay';

export function ArticleTools({focus,onFocus,onBackToTop,hasBody=true}:{focus:boolean;onFocus:()=>void;onBackToTop:()=>void;hasBody?:boolean}){
  return <div className="floating-tools" data-reading-controls>
    {hasBody&&<>
      <ReadingDisplay floating/>
      <button type="button" className="floating-tool-button" aria-label={focus?'退出专注模式':'开启专注模式'} title={focus?'退出专注模式':'开启专注模式'} aria-pressed={focus} onClick={onFocus}><IconFocus size={20}/></button>
    </>}
    <ThemeToggle/>
    <BackToTop onActivate={onBackToTop}/>
  </div>;
}
