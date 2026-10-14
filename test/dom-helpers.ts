import { act } from 'preact/test-utils';
import { render } from 'preact';

// 片付けずに次へ進むと、残った App の Triage の effect が jsdom の消えた後に走る
/** #app に描いたものを act の中で外す (#app が無ければ何もしない) */
export async function unmountApp() {
  const app = document.querySelector('#app');
  if (app) await act(() => void render(null, app));
}
