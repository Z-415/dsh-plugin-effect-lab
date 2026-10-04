/**
 * Acceptance case C host half, sibling of `dup-slot-one`.
 *
 * Loader id and package name are distinct from its sibling; only the tool name
 * collides. That is what lets the report separate the loader namespace from
 * the tool namespace.
 */

export const name = 'dsh-lab-dup-slot-two';
export const inject = ['tools'];

export async function apply(ctx) {
  try {
    const { defineTool } = await import('@deepseek-ai/dsh-tools');
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'lab_dup_tool',
      description: 'Lab fixture: shares its tool name with dsh-lab-dup-slot-one.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: () => [],
      },
      async execute() {
        return { ok: true, from: 'dsh-lab-dup-slot-two' };
      },
    })));
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-lab] dup-slot-two tool fixture skipped: ${String(error)}`);
  }
}
