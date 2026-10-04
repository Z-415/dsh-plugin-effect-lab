import fs from 'node:fs';
import path from 'node:path';

export const MOCK_PROVIDER = 'lab-mock';
export const MOCK_MODEL = 'lab-mock-model';
export const MOCK_API_KEY_ENV = 'DSH_LAB_MOCK_KEY';

/**
 * Replace the isolated profile's user patch with one pi-ai provider route that
 * points at the loopback mock server.
 */
export function writeMockProviderPatch(profileDir, options) {
  const {
    port,
    provider = MOCK_PROVIDER,
    model = MOCK_MODEL,
    apiKeyEnv = MOCK_API_KEY_ENV,
    displayName = 'Lab Mock',
  } = options;
  const file = path.join(profileDir, 'cordis.patch.yml');
  const text = [
    '# Lab-only provider patch: loopback OpenAI-compatible mock.',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    `      ${provider}:`,
    `        displayName: ${displayName}`,
    '        api: openai-completions',
    `        baseURL: http://127.0.0.1:${port}/v1`,
    `        apiKeyEnv: ${apiKeyEnv}`,
    '        models:',
    `          - id: ${model}`,
    '            name: Lab Mock Model',
    '',
  ].join('\n');
  fs.writeFileSync(file, text, 'utf8');
  return file;
}
