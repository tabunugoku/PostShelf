import { readFileSync } from 'node:fs';

/** 管理画面の CSS 全体。manager.css の @import (autocollect-dialog.css) を、その場所に展開して返す (ブラウザの読み込み順と同じ) */
export function managerCss(): string {
  const dialogCss = readFileSync('static/autocollect-dialog.css', 'utf8');
  return readFileSync('static/manager.css', 'utf8').replace('@import url("autocollect-dialog.css");', dialogCss);
}
