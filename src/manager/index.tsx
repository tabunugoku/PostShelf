import { setDocumentLang } from '../shared/strings';
import { render } from 'preact';
import { App } from './App';
import { installErrorHandlers } from './errorBus';

// sidepanel.html で開かれたときは狭い幅向けの表示 (CSS の @media と、ヘッダーのボタンの出し分け)
const surface = location.pathname.endsWith('sidepanel.html') ? 'sidepanel' : 'tab';
setDocumentLang();
installErrorHandlers();
render(<App surface={surface} />, document.getElementById('app')!);
