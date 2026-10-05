import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { resolveBridgeConfig } from './config.js';
import { runLabVerify } from './lab-cli.js';
import { summarizeReport } from './report-summary.js';
import { createBridgeRouteHandler } from './routes.js';

/**
 * dsh-plugin-effect-lab-bridge — host half.
 *
 * The bridge is installed in the DSH profile; the lab is not. The only way it
 * reaches the lab is by spawning `node <lab>/bin/lab.js verify ... --json` when
 * the `lab_verify_plugin` tool is actually called. Nothing is spawned, resolved,
 * or read at plugin startup.
 *
 * `webServer` and `tools` are hard dependencies so the Loader waits for both
 * services before running apply().
 */

export const name = 'dsh-plugin-effect-lab-bridge';
export const inject = ['webServer', 'tools'];

export const BRIDGE_ROUTE_PREFIX = '/dsh-lab-bridge';

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function toolDefinition(getConfig) {
  return defineTool({
    name: 'lab_verify_plugin',
    description:
      '调用外部的 DSH 插件效果实验舱，在它自己的临时隔离 DSH_HOME 里安装并验证一个插件，返回摘要报告。'
      + '实验舱本体不安装进当前 profile；本工具只 spawn `node <lab>/bin/lab.js verify --plugin <spec> --json`。'
      + '默认 --offline（本地目录/tarball 无需联网）。报告会通过同源路由 /dsh-lab-bridge/latest/report.html 呈现。',
    parameters: {
      plugin: {
        type: 'string',
        required: true,
        description: '传给实验舱 --plugin 的规格：本地目录、tarball 路径、npm 包名或 GitHub 规格。',
      },
      online: {
        type: 'boolean',
        description: '是否允许联网安装（true → --online）。默认 false → --offline。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true, description: '实验舱报告结论是否通过。' },
          parsed: { type: 'boolean', required: true, description: 'stdout 是否解析出 report JSON。' },
          timedOut: { type: 'boolean', required: true, description: '是否触发了硬超时。' },
          exitCode: { type: 'json', description: 'lab 进程退出码；退出码 1 也可能是有效报告。' },
          error: { type: 'string', description: '未解析出报告时的错误说明。' },
          stderrTail: { type: 'string', description: '失败时的 stderr 末尾。' },
          runId: { type: 'json' },
          mode: { type: 'json' },
          startedAt: { type: 'json' },
          finishedAt: { type: 'json' },
          checks: {
            type: 'object',
            additionalProperties: false,
            properties: {
              total: { type: 'integer', required: true },
              passed: { type: 'integer', required: true },
              failed: { type: 'integer', required: true },
            },
          },
          failedChecks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                detail: { type: 'json' },
              },
            },
          },
          keywords: { type: 'array', items: { type: 'string' } },
          runDir: { type: 'json' },
          reportHtml: { type: 'json' },
          reportJson: { type: 'json' },
          reportUrl: { type: 'string' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.parsed
            ? `实验舱结论：${value.ok ? '通过' : '未通过'} (run ${value.runId ?? '未知'})；`
              + `检查 ${value.checks?.passed ?? 0}/${value.checks?.total ?? 0} 通过；`
              + `报告：${value.reportUrl ?? '/dsh-lab-bridge/latest/report.html'}`
            : `实验舱报告解析失败：${value.error ?? '未知错误'}`,
        },
      ],
    },
    async execute(args) {
      const pluginSpec = String(args?.plugin ?? '').trim();
      if (!pluginSpec) throw new Error('plugin 参数不能为空');
      const config = getConfig();
      const outcome = await runLabVerify({
        nodeExe: config.nodeExe,
        labEntry: config.labEntry,
        pluginSpec,
        online: args?.online === true,
        artifactsDir: config.artifactsDir,
        timeoutMs: config.timeoutMs,
        cwd: config.labRoot,
      });
      return summarizeReport(outcome);
    },
  });
}

export function apply(ctx, config = {}) {
  const disposers = [];
  let cached;
  const getConfig = () => {
    cached ??= resolveBridgeConfig(config, process.env, { packageDir: PACKAGE_DIR });
    return cached;
  };

  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') {
    throw new Error('dsh-plugin-effect-lab-bridge: webServer service is missing despite inject');
  }
  disposers.push(webServer.register({
    kind: 'prefix',
    path: BRIDGE_ROUTE_PREFIX,
    handler: createBridgeRouteHandler({ getConfig }),
  }));

  const tools = ctx.tools;
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('dsh-plugin-effect-lab-bridge: tools service is missing despite inject');
  }
  disposers.push(tools.register(toolDefinition(getConfig)));

  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch { /* ignore */ }
    }
  };
}

export default { name, inject, apply };
