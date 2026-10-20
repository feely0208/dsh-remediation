/**
 * autoApply 执行器。
 *
 * 安全边界（README / skill 里也写了，这里是实现）：
 *   1. 默认 dry-run：只计算「会改哪个文件、改哪一行」，不写盘；
 *   2. 必须显式 --apply 才落盘；
 *   3. 落盘前先备份成 <file>.bak-<YYYYmmdd-HHMMSS>；
 *   4. 只处理 recipe 里声明过的 autoApply：newFile 只创建声明路径，
 *      setValue 只改 glob 命中的文件；绝不碰未声明的文件；
 *   5. 路径必须落在 --root 之内；
 *   6. 文件已存在时 newFile 不覆盖；pattern 找不到时不臆造修改。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isBackupFile, matchAny, walkFiles } from './glob.mjs';
import { renderTemplate } from './templates.mjs';

export function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function insideRoot(root, p) {
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return { abs, rel: rel.split('\\').join('/') };
}

function normalizeAfter(v) {
  return String(v);
}

function lineOf(content, index) {
  let n = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') n++;
  return n;
}

/**
 * 计算单个 setValue 的改动（不写盘）。
 * 返回 [{index, length, beforeLineNo, beforeLine, replacement}]
 */
function findSetValueChanges(content, re, after) {
  const changes = [];
  const beforeLines = content.split('\n');
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    // 找到最后一个参与匹配的捕获组 = 要被替换的值
    let groupIndex = -1;
    for (let i = m.length - 1; i >= 1; i--) {
      if (m[i] !== undefined && m.indices && m.indices[i]) {
        groupIndex = i;
        break;
      }
    }
    let start;
    let end;
    if (groupIndex > 0) {
      [start, end] = m.indices[groupIndex];
    } else {
      start = m.index;
      end = m.index + m[0].length;
    }
    const lineNo = lineOf(content, start);
    const beforeLine = beforeLines[lineNo - 1] ?? '';
    const oldText = content.slice(start, end);
    changes.push({
      start,
      end,
      oldText,
      newText: normalizeAfter(after),
      line: lineNo,
      beforeLine,
    });
  }
  return changes;
}

function applyChanges(content, changes) {
  let out = content;
  for (const c of [...changes].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, c.start) + c.newText + out.slice(c.end);
  }
  return out;
}

function diffFromContents(before, after) {
  // 值替换不增删行；按行对比给出 -/+。
  const a = before.split('\n');
  const b = after.split('\n');
  const rows = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if ((a[i] ?? '') !== (b[i] ?? '')) {
      if (a[i] !== undefined) rows.push({ kind: 'del', line: i + 1, text: a[i] });
      if (b[i] !== undefined) rows.push({ kind: 'add', line: i + 1, text: b[i] });
    }
  }
  return rows;
}

function ensureBackup(abs, backups, stampStr) {
  if (backups.has(abs)) return backups.get(abs);
  const bak = `${abs}.bak-${stampStr}`;
  if (!existsSync(bak)) writeFileSync(bak, readFileSync(abs));
  backups.set(abs, bak);
  return bak;
}

/**
 * @param {Array<{finding:object, recipe:object|null}>} items
 * @param {{root:string, apply:boolean, now?:Date}} opts
 */
export function runAutoApply(items, { root, apply, now = new Date() }) {
  const stampStr = stamp(now);
  const results = [];
  const seen = new Set();
  const backups = new Map();
  const vars = {
    YEAR: String(now.getFullYear()),
    DATE: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    PROJECT: basename(resolve(root)),
    OWNER: '（待填写：著作权人 / 主体名称）',
  };

  for (const { recipe } of items) {
    const a = recipe?.autoApply;
    if (!a) continue;
    // 一条规则只执行一次（同一 ruleId 可能在多个文件命中）
    const key = `${recipe.ruleId}::${JSON.stringify(a)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const base = {
      ruleId: recipe.ruleId,
      title: recipe.title,
      type: a.type,
      status: 'skipped',
      message: '',
      files: [],
    };

    try {
      if (a.type === 'newFile') {
        const target = insideRoot(root, a.path);
        if (!target) {
          results.push({ ...base, status: 'error', message: `目标路径不在 --root 之内，已拒绝：${a.path}` });
          continue;
        }
        if (existsSync(target.abs)) {
          results.push({ ...base, status: 'skipped', message: `目标文件已存在，不覆盖：${target.rel}` });
          continue;
        }
        const content = a.content !== undefined ? String(a.content) : renderTemplate(a.template, vars);
        if (content === null) {
          results.push({ ...base, status: 'error', message: `未知模板：${a.template}` });
          continue;
        }
        const diff = content.replace(/\n$/, '').split('\n').map((text, i) => ({ kind: 'add', line: i + 1, text }));
        if (apply) {
          mkdirSync(dirname(target.abs), { recursive: true });
          writeFileSync(target.abs, content, 'utf-8');
        }
        results.push({
          ...base,
          status: apply ? 'applied' : 'would-apply',
          message: apply ? `已创建 ${target.rel}` : `将创建 ${target.rel}`,
          files: [{ path: target.rel, backup: null, created: true, changes: diff }],
        });
        continue;
      }

      if (a.type === 'setValue') {
        const globs = Array.isArray(a.glob) ? a.glob : [a.glob];
        const flags = new Set(String(a.flags || 'g').split(''));
        flags.add('g');
        flags.add('d'); // 需要 capture group 的位置
        const re = new RegExp(a.pattern, [...flags].join(''));
        const candidates = walkFiles(root).filter((rel) => !isBackupFile(rel) && matchAny(rel, globs));
        const files = [];
        let scanned = 0;
        for (const rel of candidates) {
          const abs = join(root, rel);
          let content;
          try {
            content = readFileSync(abs, 'utf-8');
          } catch {
            continue;
          }
          if (content.includes('\u0000')) continue;
          scanned++;
          const changes = findSetValueChanges(content, re, a.after);
          if (!changes.length) continue;
          const next = applyChanges(content, changes);
          if (next === content) continue;
          const diff = diffFromContents(content, next);
          let backup = null;
          if (apply) {
            backup = `${rel}.bak-${stampStr}`;
            ensureBackup(abs, backups, stampStr);
            writeFileSync(abs, next, 'utf-8');
          }
          files.push({ path: rel, backup, created: false, count: changes.length, changes: diff });
        }
        if (!files.length) {
          results.push({
            ...base,
            status: 'skipped',
            message: `在 ${scanned} 个匹配文件中没有找到可改写的位置（可能已修复，或格式与 pattern 不一致）`,
          });
          continue;
        }
        const total = files.reduce((n, f) => n + (f.count || 0), 0);
        results.push({
          ...base,
          status: apply ? 'applied' : 'would-apply',
          message: apply
            ? `已改写 ${files.length} 个文件（${total} 处）`
            : `将改写 ${files.length} 个文件（${total} 处）`,
          files,
        });
        continue;
      }

      results.push({ ...base, status: 'error', message: `不支持的 autoApply.type：${a.type}` });
    } catch (e) {
      results.push({ ...base, status: 'error', message: e.message });
    }
  }

  return { stamp: stampStr, results };
}
