/**
 * Small DOM assertion DSL for captured probes.
 *
 * The same shape can be written by hand in a config:
 *
 *   {
 *     tokens: ['--dsw-alias-bg-base'],
 *     slots: ['conversation.composer'],
 *     bodyAttributes: ['data-we-wallpaper'],
 *     minSlots: 24
 *   }
 *
 * Check names match the historical runner output (`token:<name>`,
 * `slot:<name>`, `body-attribute:<name>`) so existing reports keep working.
 */

function isEmptyToken(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

export function evaluateDomAssertions(dom = {}, spec = {}) {
  const checks = [];
  for (const token of spec.tokens ?? []) {
    const value = dom.tokens?.[token];
    checks.push({
      name: `token:${token}`,
      pass: !isEmptyToken(value),
      detail: isEmptyToken(value) ? 'empty' : String(value),
    });
  }
  const slots = dom.slots ?? [];
  for (const slot of spec.slots ?? []) {
    const present = slots.includes(slot);
    checks.push({
      name: `slot:${slot}`,
      pass: present,
      detail: present ? 'present' : `missing (${slots.length} slot(s))`,
    });
  }
  const attributes = dom.bodyAttributes ?? {};
  for (const attribute of spec.bodyAttributes ?? []) {
    const present = Object.hasOwn(attributes, attribute);
    checks.push({
      name: `body-attribute:${attribute}`,
      pass: present,
      detail: present ? String(attributes[attribute]) : 'missing',
    });
  }
  if (Number.isFinite(spec.minSlots)) {
    const count = Number.isFinite(dom.slotCount) ? dom.slotCount : slots.length;
    checks.push({
      name: 'min-slots',
      pass: count >= spec.minSlots,
      detail: `${count} >= ${spec.minSlots}`,
    });
  }
  return { checks, ok: checks.every((check) => check.pass) };
}
