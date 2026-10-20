/**
 * recipes/ 加载与校验。
 *
 * 每条 recipe = 一条规则的「具体改法」。它不新增判据（判据来自其它插件），
 * 只回答「改到什么程度算改完、怎么验、能不能机械改」。
 *
 * 硬规则：
 *   - 没有 recipe 的规则，报告里必须明说「本条暂无专用改法」并回引 advice，
 *     绝不编一个看起来像改法的假步骤。
 *   - autoApply 只能声明两种动作：newFile / setValue；没声明就只给步骤。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = ['ruleId', 'title', 'effort', 'steps', 'verify'];

export function validateRecipe(r, file) {
  const errors = [];
  if (!r || typeof r !== 'object') return [`${file}: 不是 JSON 对象`];
  for (const k of REQUIRED) {
    if (!r[k]) errors.push(`${file}: 缺字段 ${k}`);
  }
  if (r.steps && !Array.isArray(r.steps)) errors.push(`${file}: steps 必须是数组`);
  if (r.steps && Array.isArray(r.steps) && r.steps.length === 0) errors.push(`${file}: steps 不能为空`);
  if (r.snippets && !Array.isArray(r.snippets)) errors.push(`${file}: snippets 必须是数组`);
  if (r.autoApply) {
    const a = r.autoApply;
    if (a.type === 'newFile') {
      if (!a.path) errors.push(`${file}: autoApply.newFile 缺 path`);
      if (!a.template && !a.content) errors.push(`${file}: autoApply.newFile 缺 template 或 content`);
    } else if (a.type === 'setValue') {
      if (!a.glob) errors.push(`${file}: autoApply.setValue 缺 glob`);
      if (!a.pattern) errors.push(`${file}: autoApply.setValue 缺 pattern`);
      if (a.after === undefined || a.after === null) errors.push(`${file}: autoApply.setValue 缺 after`);
      try {
        new RegExp(a.pattern);
      } catch (e) {
        errors.push(`${file}: autoApply.setValue.pattern 不是合法正则：${e.message}`);
      }
    } else {
      errors.push(`${file}: 不支持的 autoApply.type=${a.type}（只支持 newFile / setValue）`);
    }
  }
  return errors;
}

function readDir(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => join(dir, n));
}

/**
 * @returns {{recipes: Map<string,object>, files: string[], errors: string[], duplicates: string[]}}
 */
export function loadRecipes({ pkgRoot, extraDirs = [] }) {
  const dirs = [join(pkgRoot, 'recipes'), ...extraDirs];
  const recipes = new Map();
  const files = [];
  const errors = [];
  const duplicates = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      // 内置目录必须存在；--rules-from 指定的目录不存在则报错
      errors.push(`recipe 目录不存在：${dir}`);
      continue;
    }
    for (const file of readDir(dir)) {
      let r;
      try {
        r = JSON.parse(readFileSync(file, 'utf-8'));
      } catch (e) {
        errors.push(`${file}: JSON 解析失败 —— ${e.message}`);
        continue;
      }
      if (Array.isArray(r)) {
        // 允许一个文件放多条 recipe，方便用户自己扩展
        for (const one of r) errors.push(...validateRecipe(one, file));
        continue;
      }
      errors.push(...validateRecipe(r, file));
      if (!r || !r.ruleId) continue;
      if (recipes.has(r.ruleId)) {
        duplicates.push(`${r.ruleId}（${file} 覆盖了前面的同名 recipe）`);
      }
      recipes.set(r.ruleId, { ...r, _file: file });
      files.push(file);
    }
  }

  return { recipes, files, errors, duplicates };
}
