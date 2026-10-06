import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientFile = path.join(here, '..', 'lib', 'client.js');

/** Minimal React stand-in: enough to call the components and read their state. */
function makeReact() {
  const states = [];
  let cursor = 0;
  return {
    states,
    createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
    useState: (initial) => {
      const index = cursor++;
      if (states[index] === undefined) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
  };
}

function makeDocument() {
  const styleNodes = [];
  return {
    styleNodes,
    document: {
      head: { appendChild: (node) => { styleNodes.push(node); } },
      getElementById: (id) => styleNodes.find((node) => node.id === id) ?? null,
      createElement: (tag) => ({ tag, id: '', textContent: '' }),
    },
  };
}

function loadClient(fetchImpl = async () => ({ ok: true, status: 202, json: async () => ({ launched: {} }) })) {
  const source = fs.readFileSync(clientFile, 'utf8');
  const react = makeReact();
  const { document, styleNodes } = makeDocument();
  let definition = null;
  const window = { __ModuleLoader__: { load: (value) => { definition = value; } } };
  // eslint-disable-next-line no-new-func -- the browser half is a plain script.
  const run = new Function('window', 'document', 'fetch', source);
  run(window, document, fetchImpl);
  assert.equal(definition?.id, 'dsh-plugin-effect-lab-bridge');
  const exports = definition.factory((name) => {
    if (name === 'react') return react;
    throw new Error(`unexpected require: ${name}`);
  });
  return { definition, exports, react, styleNodes, document };
}

function makeCtx({ reject } = {}) {
  const registrations = [];
  return {
    registrations,
    ctx: {
      slots: {
        inject: (key, callback) => {
          if (typeof reject === 'function' && reject(key)) throw new Error(`slot "${key}" is not declared`);
          const dispose = callback();
          return typeof dispose === 'function' ? dispose : () => {};
        },
        register: (options, component) => {
          registrations.push({ options, component });
          return () => {};
        },
      },
    },
  };
}

/** Call function components until only host elements remain. */
function render(node) {
  if (Array.isArray(node)) return node.flatMap((entry) => render(entry));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return render(node.type(node.props));
  return { ...node, props: { ...node.props, children: render(node.props?.children ?? []) } };
}

function find(node, predicate) {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = find(entry, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  return find(node.props?.children ?? [], predicate);
}

function registerAll(client) {
  const { ctx, registrations } = makeCtx();
  client.exports.apply(ctx);
  const byName = (name) => registrations.filter((entry) => entry.options.name === name);
  return { registrations, byName };
}

test('client half registers the settings section, the main panel and the sidebar entry', () => {
  const client = loadClient();
  const { byName } = registerAll(client);

  assert.deepEqual(client.exports.inject, ['slots']);

  const settings = byName('settings.section');
  assert.equal(settings.length, 1);
  assert.equal(settings[0].options.id, 'effect-lab-bridge');
  assert.equal(settings[0].options.label(), '实验舱桥接');

  const main = byName('main');
  assert.equal(main.length, 1);
  assert.equal(main[0].options.key, 'effect-lab-bridge');

  const sidebar = byName('sidebar.panellist');
  assert.equal(sidebar.length, 1);
  assert.equal(sidebar[0].options.id, 'effect-lab-bridge');
  assert.equal(sidebar[0].options.label(), '实验舱');
  assert.equal(sidebar[0].options.id, main[0].options.key, 'the sidebar row must address the main panel');
  assert.equal(typeof sidebar[0].options.order, 'number');
});

test('the sidebar icon renders an svg at the size the sidebar asks for', () => {
  const client = loadClient();
  const { byName } = registerAll(client);
  const icon = byName('sidebar.panellist')[0].component;

  const big = icon({ size: 20, selected: true });
  assert.equal(big.type, 'svg');
  assert.equal(big.props.width, 20);
  assert.equal(big.props.height, 20);

  const fallback = icon({});
  assert.equal(fallback.props.width, 16);
});

test('the launch button posts {} with the injected nonce and reports the pid', async () => {
  const previous = globalThis.__DSH_LAB_BRIDGE__;
  globalThis.__DSH_LAB_BRIDGE__ = { token: 'tok-123' };
  try {
    const calls = [];
    const client = loadClient(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 202, json: async () => ({ launched: { pid: 4321 } }) };
    });
    const { byName } = registerAll(client);
    const tree = render(byName('settings.section')[0].component());
    const button = find(tree, (node) => node.type === 'button');
    assert.equal(button.props.className, 'dsh-lab-bridge__button');

    await button.props.onClick();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/dsh-lab-bridge/launch');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, '{}');
    assert.equal(calls[0].init.headers['x-dsh-lab-token'], 'tok-123');
    assert.equal(client.react.states[0].message, '实验舱已启动（pid 4321）');
    assert.equal(client.react.states[0].error, null);
  } finally {
    if (previous === undefined) delete globalThis.__DSH_LAB_BRIDGE__;
    else globalThis.__DSH_LAB_BRIDGE__ = previous;
  }
});

test('a missing nonce reports an error instead of posting', async () => {
  const previous = globalThis.__DSH_LAB_BRIDGE__;
  delete globalThis.__DSH_LAB_BRIDGE__;
  try {
    let fetchCalls = 0;
    const client = loadClient(async () => {
      fetchCalls += 1;
      throw new Error('the client must not post without a nonce');
    });
    const { byName } = registerAll(client);
    const tree = render(byName('settings.section')[0].component());
    await find(tree, (node) => node.type === 'button').props.onClick();

    assert.equal(fetchCalls, 0);
    assert.match(client.react.states[0].error, /token/);
  } finally {
    if (previous === undefined) delete globalThis.__DSH_LAB_BRIDGE__;
    else globalThis.__DSH_LAB_BRIDGE__ = previous;
  }
});

test('the client injects its stylesheet once, with a hover fill and no border', () => {
  const client = loadClient();
  const { ctx } = makeCtx();
  client.exports.apply(ctx);
  client.exports.apply(ctx);

  assert.equal(client.styleNodes.length, 1);
  assert.equal(client.styleNodes[0].id, 'dsh-lab-bridge-style');
  assert.match(client.styleNodes[0].textContent, /\.dsh-lab-bridge__button:hover:not\(:disabled\) \{ background: #e2ebff; \}/);
  assert.match(client.styleNodes[0].textContent, /border: 1px solid transparent/);
  assert.equal(/border-color:\s*#[0-9a-f]{3,6}/i.test(client.styleNodes[0].textContent), false);
});

test('a host without the sidebar seat does not break the plugin', () => {
  const client = loadClient();
  const seen = [];
  const ctx = {
    slots: {
      inject: (key, callback) => {
        seen.push(key);
        if (key !== 'settings.section') throw new Error(`slot "${key}" is not declared`);
        callback();
        return () => {};
      },
      register: () => () => {},
    },
  };
  assert.doesNotThrow(() => client.exports.apply(ctx));
  assert.deepEqual(seen, ['settings.section', 'main', 'sidebar.panellist']);
});
