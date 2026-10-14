/** esbuild の text 読み込み (build.mjs) と vitest の変換 (vitest.config.ts) で、CSS を文字列として取り込む */
declare module '*.css' {
  const text: string;
  export default text;
}
