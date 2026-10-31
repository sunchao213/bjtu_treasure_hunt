/**
 * 只为单元测试里「读源码文本」这一件事补的最小类型声明。
 *
 * 项目 tsconfig 的 `types` 只列了 vite/client，devDependencies 里也没有 @types/node，
 * 所以 `import ... from 'node:fs'` 在 tsc 阶段会报 TS2307。
 *
 * 这里只声明真正用到的签名，不引入任何依赖、不改 tsconfig、不改 vite.config。
 * 若团队后续安装了 @types/node，本文件可以直接删除（重复声明会以重载形式共存，不会报错）。
 */
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
