import { runVerifyCommand } from './verify.js';

export async function runCaptureCommand(options) {
  return runVerifyCommand({
    ...options,
    mode: 'capture',
    screenshots: options.screenshots?.length ? options.screenshots : ['home'],
  });
}
