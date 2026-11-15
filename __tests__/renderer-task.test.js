const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Exercise the actual renderer's native drop/button handlers without a WebView.
function createRenderer(storedSettings = {}) {
  const html = fs.readFileSync(path.join(__dirname, '../src/ui/renderer/index.html'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../src/ui/renderer/renderer.js'), 'utf8');
  function element(classes = '') {
    const tokens = new Set(classes.split(/\s+/).filter(Boolean));
    return {
      children: [],
      style: {},
      listeners: {},
      textContent: '',
      value: '',
      disabled: false,
      scrollTo: jest.fn(),
      classList: {
        contains: (name) => tokens.has(name),
        toggle(name, force = !tokens.has(name)) {
          if (force) tokens.add(name);
          else tokens.delete(name);
        }
      },
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children = children;
      },
      addEventListener(name, listener) {
        this.listeners[name] = listener;
      },
      querySelectorAll() {
        return [];
      },
      setAttribute() {},
      removeAttribute() {}
    };
  }
  const nodes = {};
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    nodes[match[1]] = element(match[0].match(/class="([^"]*)"/)?.[1]);
  }
  const result = {
    totalFiles: 1,
    processedFiles: 1,
    successfulConversions: 1,
    failedConversions: 0,
    skippedFiles: 0,
    duration: 0.1,
    cancelled: false,
    groups: []
  };
  const desktop = {
    getSettings: jest.fn().mockResolvedValue({
      quality: 90,
      compressJpg: true,
      skipExisting: false,
      concurrency: 4,
      ...storedSettings
    }),
    checkDependencies: jest.fn().mockResolvedValue({ imageMagick: true }),
    saveSettings: jest.fn().mockResolvedValue(),
    validateDirectories: jest.fn(async (paths) =>
      paths.map((value) => ({ path: value, name: value }))
    ),
    process: jest.fn().mockResolvedValue(result)
  };
  let drop, progress;
  const context = vm.createContext({
    document: {
      getElementById: (id) => nodes[id],
      createElement: () => element(),
      addEventListener() {}
    },
    window: { scrollTo: jest.fn() },
    Desktop: desktop,
    isMyGo: () => true,
    runtime: () => ({ platform: 'darwin' }),
    onFileDrop: (listener) => {
      drop = listener;
    },
    events: {
      conversionProgress: {
        on(listener) {
          progress = listener;
        }
      }
    },
    setTimeout,
    clearTimeout
  });
  vm.runInContext(
    source
      .replace(/^import .*;$/gm, '')
      .replace(/initialize\(\);\s*$/, 'globalThis.initialized = initialize();'),
    context
  );
  return {
    nodes,
    desktop,
    ready: context.initialized,
    drop: (paths) => drop({ paths }),
    progress: (data) => progress(data),
    start: () => nodes.startProcessingBtn.listeners.click(),
    changeSettings: () => nodes.settingsFields.listeners.input(),
    newTask: () => nodes.newProcessBtn.listeners.click(),
    visible: (id) => !nodes[id].classList.contains('hidden')
  };
}

it('dropping folders after completion opens a fresh queue without reprocessing old folders', async () => {
  const ui = createRenderer();
  await ui.ready;
  await ui.drop(['/old']);
  await ui.start();
  expect(ui.visible('newProcessBtn')).toBe(true);
  await ui.drop(['/new-one', '/new-two']);
  expect(ui.visible('dropZone')).toBe(true);
  expect(ui.visible('progressPanel')).toBe(false);
  expect(ui.visible('logDetails')).toBe(false);
  expect(ui.visible('newProcessBtn')).toBe(false);
  expect(ui.nodes.folderCount.textContent).toBe('2');
  expect(ui.nodes.startProcessingBtn.disabled).toBe(false);
  expect(ui.desktop.process).toHaveBeenCalledTimes(1);
  await ui.start();
  expect(ui.desktop.process.mock.calls[1][0]).toEqual(['/new-one', '/new-two']);
});

it('an invalid drop preserves completed results', async () => {
  const ui = createRenderer();
  await ui.ready;
  await ui.drop(['/old']);
  await ui.start();
  ui.desktop.validateDirectories.mockRejectedValueOnce(new Error('Please add a folder'));
  await ui.drop(['/file.png']);
  expect(ui.visible('newProcessBtn')).toBe(true);
  expect(ui.visible('progressPanel')).toBe(true);
  expect(ui.nodes.notice.textContent).toContain('Please add a folder');
});

it('the new-task button resets the queue and keeps output settings', async () => {
  const ui = createRenderer({ compressAboveMb: 12.5, forceUnder20Mb: true });
  await ui.ready;
  await ui.drop(['/old']);
  await ui.start();
  ui.newTask();
  expect(ui.nodes.workspace.scrollTo).toHaveBeenCalledWith(0, 0);
  expect(ui.visible('dropZone')).toBe(true);
  expect(ui.visible('progressPanel')).toBe(false);
  expect(ui.nodes.folderCount.textContent).toBe('0');
  expect(ui.nodes.qualityRange.value).toBe(90);
  expect(ui.nodes.compressJpg.checked).toBe(true);
  expect(ui.nodes.compressAboveMb.value).toBe('12.5');
  expect(ui.nodes.forceUnder20Mb.checked).toBe(true);
});

it('ignores new drops while a conversion is running', async () => {
  const ui = createRenderer();
  await ui.ready;
  await ui.drop(['/old']);
  let complete;
  const result = ui.desktop.process.getMockImplementation()();
  ui.desktop.process.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const processing = ui.start();
  await new Promise((resolve) => setImmediate(resolve));
  expect(ui.nodes.settingsFields.disabled).toBe(true);
  expect(ui.nodes.compressAboveMb.disabled).toBe(true);
  const validations = ui.desktop.validateDirectories.mock.calls.length;
  await ui.drop(['/new']);
  expect(ui.desktop.validateDirectories).toHaveBeenCalledTimes(validations);
  expect(ui.nodes.folderCount.textContent).toBe('1');
  complete(await result);
  await processing;
  expect(ui.nodes.settingsFields.disabled).toBe(false);
  expect(ui.nodes.compressAboveMb.disabled).toBe(false);
});

it('restores compression settings and sends them to saving and conversion', async () => {
  const ui = createRenderer({ compressAboveMb: 12.5, forceUnder20Mb: true });
  await ui.ready;
  await ui.drop(['/photos']);
  await ui.start();
  const expected = { compressJpg: true, compressAboveMb: 12.5, forceUnder20Mb: true };
  expect(ui.desktop.saveSettings).toHaveBeenCalledWith(expect.objectContaining(expected));
  expect(ui.desktop.process).toHaveBeenCalledWith(['/photos'], expect.objectContaining(expected));
});

it('disables the threshold when JPG compression is off while keeping the value and size cap', async () => {
  const ui = createRenderer({ compressAboveMb: 18.5, forceUnder20Mb: true });
  await ui.ready;
  await ui.drop(['/photos']);
  ui.nodes.compressJpg.checked = false;
  ui.changeSettings();
  expect(ui.nodes.compressAboveMb.disabled).toBe(true);
  expect(ui.nodes.compressAboveMb.value).toBe('18.5');
  expect(ui.nodes.forceUnder20Mb.checked).toBe(true);
  expect(ui.nodes.startProcessingBtn.disabled).toBe(false);
  await ui.start();
  expect(ui.desktop.process).toHaveBeenCalledWith(
    ['/photos'],
    expect.objectContaining({ compressJpg: false, compressAboveMb: 18.5, forceUnder20Mb: true })
  );
});

it.each([
  ['saved threshold', { compressAboveMb: 18.5 }, null, 18.5],
  ['latest valid edit', { compressAboveMb: 18.5 }, '7.25', 7.25],
  ['legacy default', {}, null, 0]
])(
  'restores the %s when compression is disabled after clearing the threshold',
  async (label, stored, edit, expected) => {
    const ui = createRenderer({ ...stored, forceUnder20Mb: true });
    await ui.ready;
    await ui.drop(['/photos']);
    if (edit !== null) {
      ui.nodes.compressAboveMb.value = edit;
      ui.changeSettings();
    }
    ui.nodes.compressAboveMb.value = '';
    ui.changeSettings();
    expect(ui.nodes.startProcessingBtn.disabled).toBe(true);
    ui.nodes.compressJpg.checked = false;
    ui.changeSettings();
    expect(ui.nodes.compressAboveMb.disabled).toBe(true);
    expect(ui.nodes.compressAboveMb.value).toBe(String(expected));
    expect(ui.nodes.startProcessingBtn.disabled).toBe(false);
    expect(ui.nodes.forceUnder20Mb.checked).toBe(true);
    await ui.start();
    const settings = { compressJpg: false, compressAboveMb: expected, forceUnder20Mb: true };
    expect(ui.desktop.saveSettings).toHaveBeenCalledWith(expect.objectContaining(settings));
    expect(ui.desktop.process).toHaveBeenCalledWith(['/photos'], expect.objectContaining(settings));
  }
);

it('keeps old settings compatible and rejects invalid thresholds before starting or saving', async () => {
  const ui = createRenderer();
  await ui.ready;
  await ui.drop(['/photos']);
  expect(ui.nodes.compressAboveMb.value).toBe('0');
  expect(ui.nodes.forceUnder20Mb.checked).toBe(false);
  for (const value of ['', '-1', 'Infinity', 'NaN', '1000000.1']) {
    ui.nodes.compressAboveMb.value = value;
    ui.changeSettings();
    expect(ui.nodes.startProcessingBtn.disabled).toBe(true);
    expect(ui.nodes.compressThresholdHint.textContent).toContain('有效 MB');
    await ui.start();
  }
  expect(ui.desktop.process).not.toHaveBeenCalled();
  expect(ui.desktop.saveSettings).not.toHaveBeenCalled();
  ui.nodes.compressAboveMb.value = '0.5';
  ui.changeSettings();
  expect(ui.nodes.startProcessingBtn.disabled).toBe(false);
  await ui.start();
  expect(ui.desktop.process).toHaveBeenCalledWith(
    ['/photos'],
    expect.objectContaining({ compressAboveMb: 0.5, forceUnder20Mb: false })
  );
});

it('shows compression retries without counting the same image as processed again', async () => {
  const ui = createRenderer({ forceUnder20Mb: true });
  await ui.ready;
  await ui.drop(['/photos']);
  let complete;
  const result = ui.desktop.process.getMockImplementation()();
  ui.desktop.process.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const processing = ui.start();
  await new Promise((resolve) => setImmediate(resolve));
  ui.progress({ type: 'start', totalStats: { total: 1, jpg: 1 }, groupCount: 1 });
  ui.progress({
    type: 'compression-retry',
    input: '/photos/large.jpg',
    quality: 85,
    outputSize: 20000000,
    maxOutputBytes: 20000000
  });
  expect(ui.nodes.progressDescription.textContent).toContain('质量 85');
  expect(ui.nodes.actionHint.textContent).toContain('已处理 0 / 1');
  expect(ui.nodes.logOutput.children.at(-1).textContent).toContain('20.0 MB');
  ui.progress({
    type: 'success',
    filename: 'large.jpg',
    outputPath: '/photos/jpg/large.jpg',
    details: { inputSize: 30000000, outputSize: 19000000, quality: 85, attempts: 2 }
  });
  expect(ui.nodes.actionHint.textContent).toContain('已处理 1 / 1');
  expect(ui.nodes.logOutput.children.at(-1).textContent).toContain('质量 85 · 压缩 2 次');
  complete(await result);
  await processing;
});

it.each([
  ['missing legacy setting', undefined, 4],
  ['saved low-memory preference', 1, 1],
  ['saved two-thread preference', 2, 2],
  ['saved three-thread preference', 3, 3],
  ['default setting', 4, 4],
  ['saved high-performance preference', 10, 10],
  ['saved large-memory preference', 20, 20]
])('restores the %s and passes it to conversion', async (label, stored, expected) => {
  const ui = createRenderer({ concurrency: stored });
  await ui.ready;
  expect(ui.nodes.concurrency.value).toBe(String(expected));
  await ui.drop(['/photos']);
  await ui.start();
  expect(ui.desktop.saveSettings).toHaveBeenCalledWith(
    expect.objectContaining({ concurrency: expected })
  );
  expect(ui.desktop.process).toHaveBeenCalledWith(
    ['/photos'],
    expect.objectContaining({ concurrency: expected })
  );
});

it.each([10, 20])(
  'persists a newly selected %i-thread mode and keeps the requested count during memory limiting',
  async (concurrency) => {
    const ui = createRenderer();
    await ui.ready;
    expect(ui.nodes.concurrency.value).toBe('4');
    ui.nodes.concurrency.value = String(concurrency);
    ui.changeSettings();
    await ui.drop(['/photos']);
    let complete;
    const result = ui.desktop.process.getMockImplementation()();
    ui.desktop.process.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const processing = ui.start();
    await new Promise((resolve) => setImmediate(resolve));
    expect(ui.desktop.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ concurrency }));
    expect(ui.desktop.process).toHaveBeenCalledWith(
      ['/photos'],
      expect.objectContaining({ concurrency })
    );
    ui.progress({ type: 'start', totalStats: { total: 1, heic: 1 }, groupCount: 1 });
    ui.progress({
      type: 'worker-pool',
      requestedConcurrency: concurrency,
      effectiveConcurrency: 3,
      memoryBudgetMb: 1024,
      message: '内存保护：本次最多使用 3 个工作线程'
    });
    expect(ui.nodes.concurrency.value).toBe(String(concurrency));
    expect(ui.nodes.logOutput.children.at(-1).textContent).toContain('最多使用 3 个工作线程');
    expect(ui.nodes.actionHint.textContent).toContain('已处理 0 / 1');
    complete(await result);
    await processing;
  }
);
