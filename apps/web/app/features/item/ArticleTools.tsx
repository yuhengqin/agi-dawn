import {IconEye} from '../../components/icons';
import {BackToTop} from '../../components/shell/Chrome';
import {ThemeToggle} from '../../components/shell/ThemeSwitch';
import {ReadingDisplay} from './ReadingDisplay';

export function ArticleTools({focus,onFocus,onBackToTop}:{focus:boolean;onFocus:()=>void;onBackToTop:()=>void}){
  return <div className="floating-tools" data-reading-controls>
    <ReadingDisplay floating/>
    <button type="button" className="floating-tool-button" aria-label={focus?'退出专注模式':'开启专注模式'} title={focus?'退出专注模式':'开启专注模式'} aria-pressed={focus} onClick={onFocus}><IconEye size={20}/></button>
    <ThemeToggle/>
    <BackToTop onActivate={onBackToTop}/>
  </div>;
}
