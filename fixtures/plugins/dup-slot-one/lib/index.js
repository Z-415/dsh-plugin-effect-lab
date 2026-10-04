/**
 * Acceptance case C host half.
 *
 * The tool name deliberately collides with `dup-slot-two` so the lab report
 * shows that tool names are a separate namespace from the loader id and the
 * slot registration id. The registration is guarded: if the minimal profile
 * does not expose the `tools` service, or the schema surface differs, the
 * fixture stays inert instead of failing the boot.
 */

export const name = 'dsh-lab-dup-slot-one';
export const inject = ['tools'];

export async function apply(ctx) {
  try {
    const { defineTool } = await import('@deepseek-ai/dsh-tools');
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'lab_dup_tool',
      description: 'Lab fixture: shares its tool name with dsh-lab-dup-slot-two.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: () => [],
      },
      async execute() {
        return { ok: true, from: 'dsh-lab-dup-slot-one' };
      },
    })));
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-lab] dup-slot-one tool fixture skipped: ${String(error)}`);
  }
}
