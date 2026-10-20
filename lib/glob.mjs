/**
 * 最小可用的 glob + 文件遍历。
 *
 * 为什么不用第三方包：本插件不引入新依赖（只依赖 core），而 autoApply 只需要
 * 「按扩展名找配置文件」「找 .github/workflows/*.yml」这类简单匹配。
 *
 * 支持：*  ?  **  {a,b}，以及对大小写敏感的文件系统语义。
 */

import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** 展开 {yml,yaml,json} 这类花括号（不处理嵌套花括号，配方里也用不到） */
export function expandBraces(pattern) {
  const m = /\{([^{}]*)\}/.exec(pattern);
  if (!m) return [pattern];
  const before = pattern.slice(0, m.index);
  const after = pattern.slice(m.index + m[0].length);
  const out = [];
  for (const part of m[1].split(',')) {
    out.push(...expandBraces(before + part + after));
  }
  return out;
}

/** 把一条 glob 编译成锚定正则 */
export function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          re += '(?:[^/]+/)*';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$+.|()[]{}'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '.svelte-kit', 'target', 'out', 'vendor', '.cache',
]);

/** 递归列出 root 下的普通文件（相对路径，统一用 /） */
export function walkFiles(root) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(abs);
      } else if (ent.isFile()) {
        files.push(relative(root, abs).split(sep).join('/'));
      }
    }
  };
  walk(root);
  return files;
}

/** 多 glob 匹配 */
export function matchAny(relPath, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  for (const p of list) {
    for (const expanded of expandBraces(String(p))) {
      if (globToRegExp(expanded).test(relPath)) return true;
    }
  }
  return false;
}

/** 是否是本插件自己产生的备份文件 */
export function isBackupFile(relPath) {
  return /\.bak-\d{8}-\d{6}$/.test(relPath) || relPath.includes('.bak-');
}
