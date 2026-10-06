import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { resolveBridgeConfig } from './config.js';
import { runLabDiagnose, runLabVerify } from './lab-cli.js';
import { summarizeDiagnosticsOutcome, summarizeReport } from './report-summary.js';
import { createBridgeRouteHandler } from './routes.js';
import { createGuiLauncher } from './launch.js';

/**
 * dsh-plugin-effect-lab-bridge — host half.
 *
 * The DSH plugin is a launcher: its UI is a single button that starts the lab's
 * own Electron GUI as an external, detached process. The lab itself is not in
 * the DSH profile and is never imported; the only host work is the fixed
 * `bin/lab.js gui` spawn plus the agent-facing lab_verify_plugin tool.
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
      + '实验舱本体不安装进当前 profile；本工具只 spawn `node <lab>/bin/lab.js verify --plugin <spec> --json`，'
      + '默认 --offline，报告写在实验舱的 artifacts 目录，可用实验舱 GUI 查看。',
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
          ok: { type: 'boolean', required: true },
          parsed: { type: 'boolean', required: true },
          timedOut: { type: 'boolean', required: true },
          exitCode: { type: 'json' },
          error: { type: 'string' },
          stderrTail: { type: 'string' },
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
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.parsed
            ? `实验舱结论：${value.ok ? '通过' : '未通过'} (run ${value.runId ?? '未知'})；`
              + `检查 ${value.checks?.passed ?? 0}/${value.checks?.total ?? 0} 通过；`
              + `报告文件：${value.reportHtml ?? value.runDir ?? '见实验舱 artifacts'}`
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

/**
 * Agent-facing diagnostic tool. The lab already redacts credentials/sessions/
 * settings and assigns stable error codes; this tool only carries that
 * structured evidence into the DSH agent, which explains the cause.
 */
function diagnoseToolDefinition(getConfig) {
  return defineTool({
    name: 'lab_diagnose',
    description:
      '读取实验舱已经产出的 report.json、脱敏诊断包(--diagnostics-bundle)或日志，'
      + '或实验舱 artifacts 下最近一次 report.json，返回结构化的稳定错误码、失败检查和有界日志末尾。'
      + '实验舱负责产出证据，DSH agent 负责解释；本工具不会读取真实凭据、sessions 或 settings。',
    parameters: {
      report: {
        type: 'string',
        description: 'report.json 的绝对路径（与 bundle/log 三选一）。',
      },
      bundle: {
        type: 'string',
        description: 'lab verify --diagnostics-bundle 产出的脱敏诊断包路径（与 report/log 三选一）。',
      },
      log: {
        type: 'string',
        description: 'boot.out.log / boot.err.log 的绝对路径（与 report/bundle 三选一）。',
      },
      latest: {
        type: 'boolean',
        description: '三者都没给时，读实验舱 artifacts 下最近一次 report.json（默认 true）。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          parsed: { type: 'boolean', required: true },
          timedOut: { type: 'boolean', required: true },
          exitCode: { type: 'json' },
          error: { type: 'string' },
          stderrTail: { type: 'string' },
          primaryCode: { type: 'json' },
          errorCodes: { type: 'array', items: { type: 'string' } },
          unknown: { type: 'boolean' },
          runId: { type: 'json' },
          source: { type: 'json' },
          signatures: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string', required: true },
                id: { type: 'json' },
                category: { type: 'json' },
                severity: { type: 'json' },
                matched: { type: 'json' },
                rootCause: { type: 'json' },
                fix: { type: 'json' },
              },
            },
          },
          failedChecks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'json' },
                detail: { type: 'json' },
              },
            },
          },
          bootTail: { type: 'array', items: { type: 'string' } },
          reportJson: { type: 'json' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.parsed
            ? `实验舱诊断：错误码 ${(value.errorCodes ?? []).join(', ')}；`
              + `命中签名 ${(value.signatures ?? []).length} 条；失败检查 ${(value.failedChecks ?? []).length} 项；`
              + `报告：${value.reportJson ?? value.source ?? '见实验舱 artifacts'}`
            : `实验舱诊断解析失败：${value.error ?? '未知错误'}`,
        },
      ],
    },
    async execute(args) {
      const config = getConfig();
      const reportPath = String(args?.report ?? '').trim() || undefined;
      const bundlePath = String(args?.bundle ?? '').trim() || undefined;
      const logPath = String(args?.log ?? '').trim() || undefined;
      const latest = !reportPath && !bundlePath && !logPath ? true : args?.latest === true;
      const outcome = await runLabDiagnose({
        nodeExe: config.nodeExe,
        labEntry: config.labEntry,
        reportPath,
        bundlePath,
        logPath,
        latest,
        artifactsDir: config.artifactsDir,
        timeoutMs: config.timeoutMs,
        cwd: config.labRoot,
      });
      return summarizeDiagnosticsOutcome(outcome);
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

  // Per-host launch nonce, injected through the standard index-injection row.
  const launchNonce = randomBytes(32).toString('base64url');
  if (typeof ctx.on === 'function') {
    const off = ctx.on('webserver/index-inject', (table) => {
      table.push({
        kind: 'global',
        name: '__DSH_LAB_BRIDGE__',
        value: { token: launchNonce },
      });
    });
    if (typeof off === 'function') disposers.push(off);
  }

  const launcher = createGuiLauncher({ getConfig });

  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') {
    throw new Error('dsh-plugin-effect-lab-bridge: webServer service is missing despite inject');
  }
  disposers.push(webServer.register({
    kind: 'prefix',
    path: BRIDGE_ROUTE_PREFIX,
    handler: createBridgeRouteHandler({
      getConfig,
      getToken: () => launchNonce,
      launcher,
    }),
  }));

  const tools = ctx.tools;
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('dsh-plugin-effect-lab-bridge: tools service is missing despite inject');
  }
  disposers.push(tools.register(toolDefinition(getConfig)));
  disposers.push(tools.register(diagnoseToolDefinition(getConfig)));

  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch { /* ignore */ }
    }
  };
}

export default { name, inject, apply };
