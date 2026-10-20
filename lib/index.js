import { createPlugin, pkgRootFrom } from '@deepwhale-cn/dsh-guard-core/plugin';

// 「问题在哪」由其它守护插件回答；这个插件回答「到底改成什么样」。
// 每条命中都配：具体步骤 / 改前改后片段 / 预计工时 / 改完怎么验，
// 能机械改的（LICENSE、配置值）默认 dry-run，显式 --apply 才落盘。
export const { name, inject, apply } = createPlugin({
  name: 'remediation',
  pkgRoot: pkgRootFrom(import.meta.url),
  skillFile: 'skill/remediation.md',
  binFile: 'bin/cli.mjs',
  description: '每条问题给具体改法，不是一句「请整改」',
  whenToUse:
    '用户拿到任意守护插件的检查报告、问「这些到底怎么改」「帮我列个整改清单」' +
    '「这条问题改成什么样才对」「改完怎么验」时使用；' +
    '或者要把检查结果变成能照着做的整改清单 / 可交付文档时使用。' +
    '典型说法：这几十条怎么改、给我整改方案、按这个报告出整改清单、' +
    '哪些能直接帮我改掉、改完怎么确认。',
});
