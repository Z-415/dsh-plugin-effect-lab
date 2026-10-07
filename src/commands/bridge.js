import { installBridge, statusBridge, uninstallBridge } from '../bridge-installer.js';

function changedText(changed = {}) {
  const parts = [];
  if (changed.dependenciesChanged) parts.push('dependencies');
  if (changed.bundlesChanged) parts.push('bundles');
  if (changed.patchChanged) parts.push('cordis.patch.yml');
  return parts.length ? parts.join(', ') : '无（已是目标状态）';
}

function printStatus(result) {
  process.stdout.write(`实验舱桥接插件状态（profile ${result.profile}）\n`);
  process.stdout.write(`- 目录: ${result.profileDir}\n`);
  process.stdout.write(`- package.json: ${result.profileExists ? '存在' : '缺失'}\n`);
  process.stdout.write(`- dependencies: ${result.dependencyPresent ? `已装 (${result.dependencySpec})` : '未装'}\n`);
  process.stdout.write(`- bundles: ${result.bundlePresent ? '已列入' : '未列入'}\n`);
  process.stdout.write(`- node_modules: ${result.nodeModulesPresent ? '存在' : '不存在'}\n`);
  process.stdout.write(`- cordis.patch.yml 里的 effect-lab-bridge 块: ${result.patchCount}\n`);
  process.stdout.write(`- labPath: ${result.labPath ?? '(未配置)'}${result.labPath ? `（${result.labPathExists ? '存在' : '不存在'}）` : ''}\n`);
  process.stdout.write(`- DSH 桌面版: ${result.dshRunning?.running ? `运行中（${result.dshRunning.reason}）` : '未运行，可以装/卸'}\n`);
  process.stdout.write(`- 结论: ${result.installed ? '已安装' : '未安装'}\n`);
}

function printResult(result) {
  if (result.action === 'status') {
    printStatus(result);
    return;
  }
  const verb = result.action === 'install' ? '安装' : '卸载';
  if (result.dryRun === true) {
    process.stdout.write(`实验舱桥接插件：${verb} dry-run（不会写入任何文件）\n`);
    process.stdout.write(`- profile: ${result.profile} (${result.profileDir})\n`);
    if (result.labPath) process.stdout.write(`- labPath: ${result.labPath}\n`);
    process.stdout.write(`- 将改动: ${changedText(result.changed)}\n`);
    if (result.dshRunning?.running) {
      process.stdout.write(`- 注意: DSH 桌面版正在运行（${result.dshRunning.reason}），真实执行会被拒绝，请先退出。\n`);
    }
    return;
  }
  if (!result.ok) {
    process.stdout.write(`实验舱桥接插件：${verb}失败\n`);
    process.stdout.write(`- 原因: ${result.error}\n`);
    if (result.errorCode) process.stdout.write(`- 错误码: ${result.errorCode}\n`);
    if (result.backupDir) process.stdout.write(`- 已回滚到备份: ${result.backupDir}\n`);
    return;
  }
  process.stdout.write(`实验舱桥接插件：${verb}完成\n`);
  process.stdout.write(`- profile: ${result.profile} (${result.profileDir})\n`);
  if (result.labPath) process.stdout.write(`- labPath: ${result.labPath}\n`);
  process.stdout.write(`- 改动: ${changedText(result.changed)}\n`);
  if (result.backupDir) process.stdout.write(`- 备份: ${result.backupDir}\n`);
  if (result.pnpm) process.stdout.write(`- pnpm install: exit ${result.pnpm.code}${result.pnpm.timedOut ? ' (timeout)' : ''}\n`);
  if (result.verify) {
    process.stdout.write(
      `- 校验: node_modules=${result.verify.nodeModulesPresent}, bundle=${result.verify.bundlePresent}, patch=${result.verify.patchCount}\n`,
    );
  }
  if (result.action === 'install') {
    process.stdout.write('- 下一步: 完全退出 DSH（含托盘）再重启，然后在 设置 → 插件 里打开「实验舱桥接」。\n');
    process.stdout.write(`- 卸载: lab bridge uninstall --profile ${result.profile}\n`);
  }
}

/**
 * `lab bridge install|uninstall|status`. Returns the process exit code:
 * 0 success, 2 refused (DSH running / missing profile or plugin), 1 failure.
 */
export async function runBridgeCommand(options = {}) {
  const { action = 'status' } = options;
  if (!['install', 'uninstall', 'status'].includes(action)) {
    process.stderr.write(`unknown bridge action: ${action} (use install|uninstall|status)\n`);
    return 2;
  }
  const common = {
    profile: options.profile ?? 'desktop',
    home: options.home,
    labPath: options.labPath,
    runtimePath: options.runtimePath,
    online: options.online === true,
    dryRun: options.dryRun === true,
    force: options.force === true,
    json: options.json === true,
  };
  const result = action === 'install'
    ? await installBridge(common)
    : action === 'uninstall'
      ? await uninstallBridge(common)
      : await statusBridge(common);

  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else printResult(result);

  if (action === 'status') return 0;
  if (result.ok) return 0;
  return result.refused ? 2 : 1;
}
