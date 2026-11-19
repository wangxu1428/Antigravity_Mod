// tests/test_i18n_teardown_unit.js : Offline unit tests for hakimi-i18n teardown, restoreEnglish & enabled logging
// Node built-ins only; zero external dependencies (no jsdom, no Electron).
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const HAKIMI_DIR = path.join(REPO_ROOT, 'plugins', 'builtin', 'hakimi-i18n');
const BUILD_JS_PATH = path.join(HAKIMI_DIR, 'hakimi-i18n', 'build.js');
const BUNDLE_JS_PATH = path.join(HAKIMI_DIR, 'hakimi-i18n.js');

const results = [];
function check(id, desc, fn) {
  try {
    fn();
    results.push({ id, ok: true });
    console.log(`PASS ${id} ${desc}`);
  } catch (err) {
    results.push({ id, ok: false });
    const msg = err && err.stack ? err.stack : String(err);
    console.log(`FAIL ${id} ${desc} :: ${msg}`);
  }
}

function createFakeDomEnv(initialConfig) {
  const logs = [];
  const warnings = [];
  const errors = [];

  class FakeNode {
    constructor(nodeType) {
      this.nodeType = nodeType;
      this.parentNode = null;
      this.parentElement = null;
    }
    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === doc.documentElement) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    remove() {
      if (this.parentNode && Array.isArray(this.parentNode.childNodes)) {
        const idx = this.parentNode.childNodes.indexOf(this);
        if (idx >= 0) this.parentNode.childNodes.splice(idx, 1);
      }
      this.parentNode = null;
      this.parentElement = null;
    }
  }

  class FakeText extends FakeNode {
    constructor(text) {
      super(3);
      this.nodeValue = String(text);
    }
  }

  class FakeClassList {
    constructor(el) {
      this._el = el;
    }
    _set() {
      return new Set((this._el.className || '').split(/\s+/).filter(Boolean));
    }
    add(...cls) {
      const s = this._set();
      cls.forEach((c) => s.add(c));
      this._el.className = Array.from(s).join(' ');
    }
    remove(...cls) {
      const s = this._set();
      cls.forEach((c) => s.delete(c));
      this._el.className = Array.from(s).join(' ');
    }
    contains(c) {
      return this._set().has(c);
    }
    [Symbol.iterator]() {
      return this._set().values();
    }
  }

  class FakeElement extends FakeNode {
    constructor(tagName) {
      super(1);
      this.tagName = String(tagName || 'DIV').toUpperCase();
      this.childNodes = [];
      this._attrs = Object.create(null);
      this.className = '';
      this.classList = new FakeClassList(this);
      this.style = {};
      this.shadowRoot = null;
      this._listeners = Object.create(null);
    }
    get id() {
      return this._attrs.id || '';
    }
    set id(val) {
      if (val === undefined || val === null || val === '') {
        delete this._attrs.id;
      } else {
        this._attrs.id = String(val);
      }
    }
    get children() {
      return this.childNodes.filter((n) => n.nodeType === 1);
    }
    get textContent() {
      return this.childNodes
        .map((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent))
        .join('');
    }
    set textContent(val) {
      this.childNodes = [];
      if (val !== undefined && val !== null && val !== '') {
        this.appendChild(new FakeText(String(val)));
      }
    }
    set innerHTML(val) {
      this._innerHTML = String(val || '');
      this.childNodes = [];
    }
    get innerHTML() {
      return this._innerHTML || '';
    }
    appendChild(child) {
      if (child.parentNode) child.remove();
      child.parentNode = this;
      child.parentElement = this;
      this.childNodes.push(child);
      return child;
    }
    setAttribute(name, val) {
      const k = String(name);
      this._attrs[k] = String(val);
      if (k === 'class') this.className = String(val);
    }
    getAttribute(name) {
      const k = String(name);
      return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null;
    }
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, String(name));
    }
    removeAttribute(name) {
      delete this._attrs[String(name)];
    }
    addEventListener(type, fn) {
      if (!this._listeners[type]) this._listeners[type] = new Set();
      this._listeners[type].add(fn);
    }
    removeEventListener(type, fn) {
      if (this._listeners[type]) this._listeners[type].delete(fn);
    }
    querySelectorAll() {
      return [];
    }
    querySelector() {
      return null;
    }
    closest() {
      return null;
    }
  }

  function Document() {
    this._title = 'Antigravity';
    this._listeners = Object.create(null);
  }
  Object.defineProperty(Document.prototype, 'title', {
    configurable: true,
    enumerable: true,
    get() {
      return this._title;
    },
    set(val) {
      this._title = String(val);
    },
  });

  const NodeFilter = {
    SHOW_ELEMENT: 1,
    SHOW_TEXT: 4,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
  };

  const doc = new Document();
  const htmlEl = new FakeElement('HTML');
  const headEl = new FakeElement('HEAD');
  const bodyEl = new FakeElement('BODY');
  htmlEl.appendChild(headEl);
  htmlEl.appendChild(bodyEl);
  doc.documentElement = htmlEl;
  doc.head = headEl;
  doc.body = bodyEl;

  doc.createElement = (tag) => new FakeElement(tag);
  doc.createTextNode = (txt) => new FakeText(txt);
  doc.addEventListener = (type, fn) => {
    if (!doc._listeners[type]) doc._listeners[type] = new Set();
    doc._listeners[type].add(fn);
  };
  doc.removeEventListener = (type, fn) => {
    if (doc._listeners[type]) doc._listeners[type].delete(fn);
  };
  doc.getElementById = (id) => {
    const stack = [doc.documentElement];
    while (stack.length > 0) {
      const cur = stack.shift();
      if (cur.nodeType === 1) {
        if (cur.id === id) return cur;
        for (let i = 0; i < cur.childNodes.length; i++) {
          stack.push(cur.childNodes[i]);
        }
      }
    }
    return null;
  };
  doc.createTreeWalker = (root, whatToShow, filter) => {
    const accepted = [];
    const acceptFn = filter && typeof filter.acceptNode === 'function' ? filter.acceptNode : null;

    function walkChildren(parent) {
      if (!parent || !Array.isArray(parent.childNodes)) return;
      for (let i = 0; i < parent.childNodes.length; i++) {
        const child = parent.childNodes[i];
        const maskMatch =
          (child.nodeType === 1 && (whatToShow & NodeFilter.SHOW_ELEMENT) !== 0) ||
          (child.nodeType === 3 && (whatToShow & NodeFilter.SHOW_TEXT) !== 0);

        let decision = maskMatch ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        if (maskMatch && acceptFn) {
          decision = acceptFn(child);
        }

        if (decision === NodeFilter.FILTER_REJECT) {
          continue;
        }
        if (decision === NodeFilter.FILTER_ACCEPT) {
          accepted.push(child);
        }
        if (child.nodeType === 1) {
          walkChildren(child);
        }
      }
    }

    walkChildren(root);
    let idx = -1;
    return {
      nextNode() {
        idx += 1;
        return idx < accepted.length ? accepted[idx] : null;
      },
    };
  };

  let nextTimerId = 1;
  const activeTimers = new Map();
  function fakeSetTimeout(fn, delay) {
    const id = nextTimerId++;
    activeTimers.set(id, { fn, delay });
    return id;
  }
  function fakeClearTimeout(id) {
    activeTimers.delete(id);
  }

  let observerObserveCalls = 0;
  let observerDisconnectCalls = 0;
  const activeObservers = new Set();
  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.observing = false;
    }
    observe() {
      observerObserveCalls++;
      this.observing = true;
      activeObservers.add(this);
    }
    disconnect() {
      observerDisconnectCalls++;
      this.observing = false;
      activeObservers.delete(this);
    }
  }

  function History() {}
  const fakeHistory = new History();
  fakeHistory.pushState = function () {};
  fakeHistory.replaceState = function () {};

  const windowListeners = Object.create(null);
  const win = {
    document: doc,
    Document,
    Element: FakeElement,
    History,
    history: fakeHistory,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter,
    MutationObserver: FakeMutationObserver,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    addEventListener(type, fn) {
      if (!windowListeners[type]) windowListeners[type] = new Set();
      windowListeners[type].add(fn);
    },
    removeEventListener(type, fn) {
      if (windowListeners[type]) windowListeners[type].delete(fn);
    },
    HakimiPluginHost: {
      version: '2.1.0',
      config: initialConfig,
      plugins: {},
      register(name, pluginObj) {
        this.plugins[name] = pluginObj;
        if (pluginObj && typeof pluginObj.init === 'function') {
          pluginObj.init(this.config);
        }
      },
    },
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  win.console = {
    log: (...args) => logs.push(args.map(String).join(' ')),
    warn: (...args) => warnings.push(args.map(String).join(' ')),
    error: (...args) => errors.push(args.map(String).join(' ')),
  };

  const sandbox = {
    window: win,
    self: win,
    globalThis: win,
    document: doc,
    Document,
    Element: FakeElement,
    History,
    history: fakeHistory,
    Node: win.Node,
    NodeFilter,
    MutationObserver: FakeMutationObserver,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    console: win.console,
    Set,
    Map,
    WeakMap,
    WeakSet,
    RegExp,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date,
    Error,
    JSON,
    Math,
    Promise,
  };

  return {
    win,
    doc,
    sandbox,
    FakeElement,
    FakeText,
    logs,
    warnings,
    errors,
    activeTimers,
    activeObservers,
    getObserverStats: () => ({
      observeCalls: observerObserveCalls,
      disconnectCalls: observerDisconnectCalls,
      activeCount: activeObservers.size,
    }),
  };
}

function buildSampleUi(env) {
  const { doc, FakeElement, FakeText } = env;
  doc.title = 'Settings';

  const nav = new FakeElement('DIV');
  const btnNew = new FakeElement('BUTTON');
  const txtNew = new FakeText('New Conversation');
  btnNew.appendChild(txtNew);

  const btnSettings = new FakeElement('BUTTON');
  btnSettings.setAttribute('title', 'Settings');
  const txtSettings = new FakeText('Settings');
  btnSettings.appendChild(txtSettings);

  const proj = new FakeElement('SPAN');
  const txtProject = new FakeText('No Project');
  proj.appendChild(txtProject);

  nav.appendChild(btnNew);
  nav.appendChild(btnSettings);
  nav.appendChild(proj);
  doc.body.appendChild(nav);

  return { btnNew, txtNew, btnSettings, txtSettings, proj, txtProject };
}

function runBundle(env, bundleSrc) {
  vm.runInNewContext(bundleSrc, env.sandbox, { filename: 'hakimi-i18n.js' });
}

function runAll() {
  const buildSrc = fs.readFileSync(BUILD_JS_PATH, 'utf8');
  const bundleSrc = fs.readFileSync(BUNDLE_JS_PATH, 'utf8');

  // IT1: build.js and hakimi-i18n.js are in sync and contain teardown + enabled logging markers
  check('IT1', 'build.js and hakimi-i18n.js stay in sync and include restoreEnglish + config.enabled logs', () => {
    let generated = null;
    const fakeFs = {
      readFileSync: fs.readFileSync.bind(fs),
      writeFileSync: (_p, content) => {
        generated = content;
      },
      statSync: () => ({ size: generated ? Buffer.byteLength(generated, 'utf8') : 0 }),
    };
    const buildFn = new Function('require', '__dirname', 'console', buildSrc);
    buildFn((m) => (m === 'fs' ? fakeFs : require(m)), path.dirname(BUILD_JS_PATH), { log: () => {} });

    assert.strictEqual(typeof generated, 'string', 'build.js did not produce output');
    assert.strictEqual(
      bundleSrc.replace(/\r\n/g, '\n'),
      generated.replace(/\r\n/g, '\n'),
      'hakimi-i18n.js is out of sync with build.js; run node build.js'
    );
    assert.ok(buildSrc.includes('domAdapter.restoreEnglish()'), 'build.js missing domAdapter.restoreEnglish()');
    assert.ok(buildSrc.includes('config.enabled='), 'build.js missing config.enabled= log');
    assert.ok(bundleSrc.includes('domAdapter.restoreEnglish()'), 'hakimi-i18n.js missing domAdapter.restoreEnglish()');
    assert.ok(bundleSrc.includes('config.enabled='), 'hakimi-i18n.js missing config.enabled= log');
  });

  // IT2: Init with enabled=true translates DOM text, attributes, and document.title, and logs config.enabled=true
  check('IT2', 'init with i18n.enabled=true translates fake DOM and logs config.enabled=true', () => {
    const env = createFakeDomEnv({ i18n: { enabled: true, language: 'zh-CN' } });
    const ui = buildSampleUi(env);
    runBundle(env, bundleSrc);

    assert.strictEqual(env.errors.length, 0, 'unexpected console.error: ' + env.errors.join('; '));
    assert.strictEqual(ui.txtNew.nodeValue, '新建会话');
    assert.strictEqual(ui.txtSettings.nodeValue, '设置');
    assert.strictEqual(ui.txtProject.nodeValue, '未选择项目');
    assert.strictEqual(ui.btnSettings.getAttribute('title'), '设置');
    assert.strictEqual(env.doc.title, '设置');
    assert.strictEqual(env.win.__HAKIMI_I18N__.domAdapter.active, true);
    assert.ok(
      env.logs.some((l) => l.includes('[Hakimi i18n] config.enabled=true')),
      'missing [Hakimi i18n] config.enabled=true log'
    );
  });

  // IT3: __hakimiI18nTeardown calls restoreEnglish() before stop(), restores English DOM, clears timers/observers, logs enabled
  check('IT3', 'teardown invokes restoreEnglish before stop, restores English DOM, and cleans resources', () => {
    const env = createFakeDomEnv({ i18n: { enabled: true, language: 'zh-CN' } });
    const ui = buildSampleUi(env);
    runBundle(env, bundleSrc);

    const adapter = env.win.__HAKIMI_I18N__.domAdapter;
    const callOrder = [];
    const origRestore = adapter.restoreEnglish.bind(adapter);
    const origStop = adapter.stop.bind(adapter);
    adapter.restoreEnglish = function (...args) {
      callOrder.push({ fn: 'restoreEnglish', activeAtEntry: adapter.active });
      return origRestore(...args);
    };
    adapter.stop = function (...args) {
      callOrder.push({ fn: 'stop', activeAtEntry: adapter.active });
      return origStop(...args);
    };

    assert.strictEqual(typeof env.win.__hakimiI18nTeardown, 'function');
    env.win.__hakimiI18nTeardown();

    assert.ok(callOrder.length >= 2, 'expected restoreEnglish and stop calls');
    assert.strictEqual(callOrder[0].fn, 'restoreEnglish', 'restoreEnglish must run first');
    assert.strictEqual(callOrder[0].activeAtEntry, true, 'stop must not run before restoreEnglish');
    assert.ok(callOrder.some((c) => c.fn === 'stop'), 'stop must be invoked');

    assert.strictEqual(ui.txtNew.nodeValue, 'New Conversation');
    assert.strictEqual(ui.txtSettings.nodeValue, 'Settings');
    assert.strictEqual(ui.txtProject.nodeValue, 'No Project');
    assert.strictEqual(ui.btnSettings.getAttribute('title'), 'Settings');
    assert.strictEqual(env.doc.title, 'Settings');
    assert.strictEqual(adapter.active, false);
    assert.strictEqual(env.activeTimers.size, 0, 'all scheduled timers must be cleared');
    assert.strictEqual(env.getObserverStats().activeCount, 0, 'all MutationObservers must be disconnected');
    assert.strictEqual(env.win.__hakimiI18nTeardown, null);
    assert.ok(
      env.logs.some((l) => l.includes('Tearing down Hakimi i18n instance... config.enabled=true')),
      'teardown log must include config.enabled'
    );
  });

  // IT4: Full hot-reload simulation (F5): enabled=true -> change config enabled=false -> re-inject -> English restored and stays English
  check('IT4', 'hot reload after switching i18n.enabled=false restores English UI and does not restart translation', () => {
    const env = createFakeDomEnv({ i18n: { enabled: true, language: 'zh-CN' } });
    const ui = buildSampleUi(env);
    runBundle(env, bundleSrc);

    assert.strictEqual(ui.txtSettings.nodeValue, '设置');
    assert.strictEqual(ui.txtProject.nodeValue, '未选择项目');

    // Simulate reload after plugins/config.json was edited to i18n.enabled=false
    env.logs.length = 0;
    env.win.HakimiPluginHost.config = { i18n: { enabled: false, language: 'zh-CN' } };
    const beforeReloadStats = env.getObserverStats();
    runBundle(env, bundleSrc);
    const afterReloadStats = env.getObserverStats();

    assert.strictEqual(env.errors.length, 0, 'unexpected console.error: ' + env.errors.join('; '));
    assert.strictEqual(ui.txtNew.nodeValue, 'New Conversation');
    assert.strictEqual(ui.txtSettings.nodeValue, 'Settings');
    assert.strictEqual(ui.txtProject.nodeValue, 'No Project');
    assert.strictEqual(ui.btnSettings.getAttribute('title'), 'Settings');
    assert.strictEqual(env.doc.title, 'Settings');
    assert.strictEqual(env.win.__HAKIMI_I18N__.domAdapter.active, false);
    assert.strictEqual(env.activeTimers.size, 0);
    assert.strictEqual(afterReloadStats.activeCount, 0);
    assert.strictEqual(afterReloadStats.observeCalls, beforeReloadStats.observeCalls, 'must not attach new observer when disabled');

    assert.ok(
      env.logs.some((l) => l.includes('Tearing down Hakimi i18n instance... config.enabled=true')),
      'reload must trigger old teardown log'
    );
    assert.ok(
      env.logs.some((l) => l.includes('[Hakimi i18n] config.enabled=false')),
      'reload must log new config.enabled=false'
    );
    assert.ok(
      env.logs.some((l) => l.includes('skipping domAdapter.start()')),
      'reload must log skipped domAdapter.start()'
    );
  });

  // IT5: Fresh init with enabled=false never calls domAdapter.start() and logs config.enabled=false
  check('IT5', 'fresh init with i18n.enabled=false skips domAdapter.start() and logs config.enabled=false', () => {
    const env = createFakeDomEnv({ i18n: { enabled: false, language: 'zh-CN' } });
    const ui = buildSampleUi(env);
    runBundle(env, bundleSrc);

    assert.strictEqual(ui.txtNew.nodeValue, 'New Conversation');
    assert.strictEqual(ui.txtSettings.nodeValue, 'Settings');
    assert.strictEqual(ui.txtProject.nodeValue, 'No Project');
    assert.strictEqual(env.win.__HAKIMI_I18N__.domAdapter.active, false);
    assert.strictEqual(env.getObserverStats().observeCalls, 0);
    assert.strictEqual(env.activeTimers.size, 0);
    assert.ok(env.logs.some((l) => l.includes('[Hakimi i18n] config.enabled=false')));
    assert.ok(env.logs.some((l) => l.includes('skipping domAdapter.start()')));
  });

  // IT6: Teardown still runs stop(), configUI.destroy(), and clears __hakimiI18nTeardown if restoreEnglish throws
  check('IT6', 'teardown catches restoreEnglish errors and still stops adapter and destroys UI', () => {
    const env = createFakeDomEnv({ i18n: { enabled: true, language: 'zh-CN' } });
    buildSampleUi(env);
    runBundle(env, bundleSrc);

    const { domAdapter, configUI } = env.win.__HAKIMI_I18N__;
    let stopCalled = false;
    let destroyCalled = false;
    domAdapter.restoreEnglish = () => {
      throw new Error('simulated restore failure');
    };
    const origStop = domAdapter.stop.bind(domAdapter);
    domAdapter.stop = () => {
      stopCalled = true;
      origStop();
    };
    const origDestroy = configUI.destroy.bind(configUI);
    configUI.destroy = () => {
      destroyCalled = true;
      origDestroy();
    };

    env.win.__hakimiI18nTeardown();

    assert.strictEqual(stopCalled, true, 'domAdapter.stop() must still run');
    assert.strictEqual(destroyCalled, true, 'configUI.destroy() must still run');
    assert.strictEqual(env.win.__hakimiI18nTeardown, null, 'teardown handle must be cleared');
    assert.ok(
      env.warnings.some((w) => w.includes('restoreEnglish error during teardown')),
      'warning should be logged when restoreEnglish throws'
    );
  });

  const f = results.filter((r) => !r.ok).length;
  console.log(`SUMMARY pass=${results.length - f} fail=${f}`);
  process.exitCode = f ? 1 : 0;
}

runAll();
