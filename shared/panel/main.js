// Studio panel: pick sources, tap a tile, open what was made. Defaults are chosen for the
// user; problems are retried quietly by the service and only reach the user as plain words.
import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { installPanelFont } from './fonts.js';
import { LIMITS } from '../common/core.mjs';
import { CHOICES, FORMATS, defaultChoice } from '../common/formats.mjs';
import { DOCUMENT_CAPS } from '../common/documents.mjs';
import { ICONS, NOUNS, TILES } from './icons.js';
import { canCreate, chosenModel as resolveModel, contextQuery, hostContext, modelFromKey, selectionContext } from './context.mjs';
import { pictureBase64 } from './viewers/infographic.js';
import { renderViewer } from './viewers/index.js';

const host = connectHost();
const $ = (id) => document.getElementById(id);
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const icon = (name, className = 'icon') => {
  const span = make('span', className);
  span.innerHTML = ICONS[name]; // Trusted constant markup from icons.js only.
  return span;
};

const state = {
  context: null, hostScope: null, hostSelection: null, sessionBusy: false, initialized: false, epoch: 0, connectionEpoch: 0,
  connection: null, connectionError: null, connecting: null, retryDelay: 2000, retryTimer: null,
  modelPref: 'auto', agentPref: 'auto', secondPass: true, preferenceRevision: 0, selectionPending: true, selectionPrompted: false, settingsDraft: null,
  entries: [], selected: new Map(),
  sourceFolder: '', sourceNext: null, sourceTotal: 0, sourceSort: 'name', sourceDirection: 'asc',
  sourceLoading: false, sourceRequest: 0, sourceTimer: null, sourceChecks: new Set(), sourceErrors: new Map(),
  chat: null, chatSelected: false, chatChoice: null, chatRequest: 0, chatTimer: null,
  rows: [], next: null, active: new Map(), pollTimer: null,
  viewer: null, customizing: null, snackTimer: null,
};

// ---------- small helpers ----------

const query = (extra = {}) => contextQuery(state.context, extra);

async function rpc(method, path, body) {
  const response = await host.serviceRequest({ method, path, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data;
  try { data = JSON.parse(response.body); } catch { data = {}; }
  if (response.status >= 400) {
    const error = new Error(data.error?.message || 'Studio could not complete this.');
    error.code = data.error?.code;
    throw error;
  }
  return data;
}

// Quality preference belongs to Studio, so an explicit off does not silently turn on
// when the user moves to another project. Agent/model overrides remain project-scoped.
const storageKey = (name) => name === 'second-pass' ? name : `${name}:${state.context?.directory ?? ''}`.slice(0, 128);
async function remember(name, value) { try { await host.storage.set(storageKey(name), value); } catch { /* Preferences are a convenience only. */ } }
async function recall(name) { try { return await host.storage.get(storageKey(name)); } catch { return undefined; } }

function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
const sourcesLabel = (count) => `${count} source${count === 1 ? '' : 's'}`;
const modelName = (ref) => state.connection?.models.find((model) => model.ref.providerID === ref?.providerID && model.ref.id === ref?.id)?.label
  ?? (ref ? `${ref.providerID}/${ref.id}` : 'unknown');

function snack(text, action) {
  clearTimeout(state.snackTimer);
  $('snackbar-text').textContent = text;
  const button = $('snackbar-action');
  button.hidden = !action;
  if (action) { button.textContent = action.label; button.onclick = () => { $('snackbar').hidden = true; action.run(); }; }
  $('snackbar').hidden = false;
  state.snackTimer = setTimeout(() => { $('snackbar').hidden = true; }, action ? 8000 : 4500);
}

function notice(text) {
  $('notice').hidden = !text;
  $('notice').textContent = text ?? '';
}

// ---------- connection (quiet, self-retrying) ----------

function chosenModel() {
  return resolveModel(state.connection, state.modelPref);
}

const hasWorkingAI = () => !state.selectionPending && canCreate(state.connection, state.modelPref);

function paintAvailability() {
  const ready = hasWorkingAI();
  for (const button of document.querySelectorAll('.tile-main[data-format]')) {
    button.disabled = !ready;
    button.title = ready ? `Choose options for ${TILES[button.dataset.format].name}` : 'Select an available AI agent and model first.';
  }
  $('customize-go').disabled = !ready;
}

function connect() {
  if (state.connecting) return state.connecting;
  const epoch = state.epoch;
  const connectionEpoch = state.connectionEpoch;
  clearTimeout(state.retryTimer);
  state.selectionPending = true;
  paintSettings();
  const context = selectionContext(state.context, state.agentPref, state.modelPref);
  const task = (async () => {
    try {
      const result = await rpc('GET', `/connection?${contextQuery(context)}`);
      if (epoch !== state.epoch || connectionEpoch !== state.connectionEpoch) return null;
      state.context = context;
      state.connection = result;
      state.connectionError = null;
      state.selectionPending = false;
      state.retryDelay = 2000;
      notice(hasWorkingAI() ? null : result.selectionError || 'Choose an available AI agent and model to enable creation.');
      paintSettings();
      if (!hasWorkingAI() && !state.selectionPrompted) openSettings(true);
      return result;
    } catch (error) {
      if (epoch !== state.epoch || connectionEpoch !== state.connectionEpoch) return null;
      state.connection = null;
      state.selectionPending = false;
      state.connectionError = ['LOCAL_HOST_REQUIRED', 'AUTH_REQUIRED'].includes(error.code)
        ? 'Studio works with an unprotected local OpenChamber host only.'
        : error.code === 'NO_MODEL' ? 'No AI model is turned on in OpenChamber yet. Add one in OpenChamber settings.'
          : ['WRONG_DIRECTORY', 'WRONG_SERVER'].includes(error.code) ? 'Studio could not match this chat to its folder. Reselect the chat in OpenChamber.'
            : 'Connecting to OpenChamber. Studio will try again shortly.';
      notice(state.connectionError);
      paintSettings();
      if (['NO_AGENT', 'NO_MODEL', 'AI_SELECTION_REQUIRED'].includes(error.code) && !state.selectionPrompted) openSettings(true);
      state.retryTimer = setTimeout(() => {
        if (epoch === state.epoch && connectionEpoch === state.connectionEpoch) void connect();
      }, state.retryDelay);
      state.retryDelay = Math.min(state.retryDelay * 2, 30_000);
      return null;
    } finally {
      // An old request must not clear a newer chat's in-flight connection.
      if (state.connecting === task) state.connecting = null;
    }
  })();
  state.connecting = task;
  return task;
}

// ---------- sources ----------

// Browsing reads names and metadata only. A file is parsed by the service when the user
// ticks it; folder navigation never reads all the documents below the current directory.
const chatSize = () => (state.chat?.available ? state.chat.characters : 0);
const selectedSize = () => [...state.selected.values()].reduce((sum, characters) => sum + characters, 0)
  + (state.chatSelected ? chatSize() : 0);

async function loadSources({ folder = state.sourceFolder, append = false, attempt = 0 } = {}) {
  if (!state.context?.directory) return;
  const epoch = state.epoch;
  const request = ++state.sourceRequest;
  clearTimeout(state.sourceTimer);
  const offset = append ? state.sourceNext : 0;
  if (append && offset === null) return;
  state.sourceFolder = folder;
  state.sourceLoading = true;
  if (!append) { state.entries = []; state.sourceNext = null; state.sourceTotal = 0; }
  paintSources('Opening folder...');
  try {
    const result = await rpc('GET', `/sources?${query({ folder, offset, sort: state.sourceSort, direction: state.sourceDirection })}`);
    if (epoch !== state.epoch || request !== state.sourceRequest) return;
    state.entries = append ? [...state.entries, ...result.entries] : result.entries;
    state.sourceNext = result.next;
    state.sourceTotal = result.total;
    state.sourceLoading = false;
    paintSources();
  } catch (error) {
    if (epoch !== state.epoch || request !== state.sourceRequest) return;
    state.sourceLoading = false;
    paintSources(error.code === 'BAD_FOLDER' ? error.message : 'Studio could not open this folder. Use Refresh to try again.');
    // Retry a cold service only; never navigate later to a superseded folder.
    if (!error.code && attempt < 2) state.sourceTimer = setTimeout(() => {
      if (epoch === state.epoch && request === state.sourceRequest) void loadSources({ folder, append, attempt: attempt + 1 });
    }, 2000);
  }
}

async function loadChat(attempt = 0) {
  const epoch = state.epoch;
  const request = ++state.chatRequest;
  clearTimeout(state.chatTimer);
  if (!state.context?.sessionId) { state.chat = null; state.chatSelected = false; paintSources(); return; }
  try {
    const chat = await rpc('GET', `/chat?${query()}`);
    if (epoch !== state.epoch || request !== state.chatRequest) return;
    state.chat = chat;
    // A chat appearing after the first message is selected once it is available. An explicit
    // untick wins for this chat, even when refreshed or its model changes.
    const fileSize = [...state.selected.values()].reduce((sum, characters) => sum + characters, 0);
    state.chatSelected = Boolean(chat.available) && state.chatChoice !== false && fileSize + chatSize() <= LIMITS.source;
    paintSources();
    if (!chat.available && attempt < 1) state.chatTimer = setTimeout(() => {
      if (epoch === state.epoch && request === state.chatRequest) void loadChat(attempt + 1);
    }, 3000);
  } catch {
    if (epoch !== state.epoch || request !== state.chatRequest) return;
    state.chat = { available: false, reason: 'Chat is not available yet. Use Refresh to try again.' };
    state.chatSelected = false;
    paintSources();
    if (attempt < 1) state.chatTimer = setTimeout(() => {
      if (epoch === state.epoch && request === state.chatRequest) void loadChat(attempt + 1);
    }, 3000);
  }
}

function sourceRow({ checked, disabled, iconName, name, path, note, metadata, onChange }) {
  const row = make('li');
  const label = make('label', `check-row${disabled ? ' disabled' : ''}`);
  const box = make('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.disabled = disabled;
  if (path) box.dataset.path = path;
  box.addEventListener('change', () => onChange(box));
  const text = make('span', 'source-name');
  text.append(icon(iconName, 'icon small'), make('span', null, name));
  const body = make('span', 'source-body');
  body.append(text);
  if (note) body.append(make('span', 'source-note', note));
  if (path) label.title = path;
  label.append(box, body);
  if (metadata) label.append(make('span', 'source-meta', metadata));
  row.append(label);
  return row;
}

function metadata(file) {
  if (state.sourceSort === 'createdAt' || state.sourceSort === 'modifiedAt') {
    const timestamp = file[state.sourceSort];
    return typeof timestamp === 'number' && Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString() : 'Not available';
  }
  if (file.entryType !== 'file' || typeof file.size !== 'number') return '';
  if (file.size < 1024) return `${file.size} B`;
  if (file.size < 1024 * 1024) return `${(file.size / 1024).toFixed(1)} KB`;
  return `${(file.size / 1024 / 1024).toFixed(1)} MB`;
}

function paintLocation() {
  const home = state.context?.directory;
  $('source-home-path').textContent = home || 'Finding the session folder...';
  $('source-home-path').title = home || '';
  const folder = state.sourceFolder;
  $('source-up').disabled = !folder || !home;
  $('source-home').disabled = !home;
  const crumbs = [];
  const add = (name, path) => {
    const button = make('button', null, name);
    button.type = 'button';
    if (path === folder) button.setAttribute('aria-current', 'location');
    button.addEventListener('click', () => { void loadSources({ folder: path }); });
    if (crumbs.length) crumbs.push(make('span', 'muted', '/'));
    crumbs.push(button);
  };
  add('Home', '');
  let relative = '';
  for (const segment of folder.split('/').filter(Boolean)) {
    relative = relative ? `${relative}/${segment}` : segment;
    add(segment, relative);
  }
  $('source-breadcrumbs').replaceChildren(...crumbs);
  const separator = home?.includes('\\') ? '\\' : '/';
  $('source-location').hidden = !folder;
  $('source-location').textContent = home ? `${home.replace(/[\\/]$/, '')}${separator}${folder.split('/').join(separator)}` : '';
  $('source-sort').value = state.sourceSort;
  const direction = `Sort ${state.sourceDirection === 'asc' ? 'ascending; switch to descending' : 'descending; switch to ascending'}`;
  $('source-direction').title = direction;
  $('source-direction').setAttribute('aria-label', direction);
  $('source-direction').setAttribute('aria-pressed', String(state.sourceDirection === 'desc'));
}

function paintSources(message) {
  paintLocation();
  const rows = [];
  $('chat-source').replaceChildren(...(state.context?.sessionId ? [sourceRow({
      checked: state.chatSelected, iconName: 'chat', name: 'This chat',
      disabled: !state.chat?.available,
      note: !state.chat?.available ? state.chat?.reason ?? 'Checking this chat...'
        : state.chat.compressed ? 'Over 25,000 words: its key points will be used.'
          : Number.isFinite(state.chat.words) ? `${state.chat.words.toLocaleString()} words from this chat.` : 'The conversation in this chat.',
      onChange: (box) => toggleChat(box),
    })] : []));
  for (const file of state.entries) {
    if (file.entryType === 'directory') {
      const row = make('li');
      const button = make('button', 'folder-row');
      button.type = 'button';
      button.title = `Open ${file.path}`;
      button.setAttribute('aria-label', `Open folder ${file.name}`);
      button.append(icon('folder'), make('span', 'source-body', file.name));
      if (metadata(file)) button.append(make('span', 'source-meta', metadata(file)));
      button.append(make('span', 'folder-enter', '>'));
      button.addEventListener('click', () => { void loadSources({ folder: file.path }); });
      row.append(button);
      rows.push(row);
      continue;
    }
    const error = state.sourceErrors.get(file.path) || file.error;
    const pending = state.sourceChecks.has(file.path);
    rows.push(sourceRow({
      checked: state.selected.has(file.path), disabled: pending || !file.kind || Boolean(error), iconName: 'file', name: file.name, path: file.path,
      note: pending ? 'Reading selected file...' : error || '', metadata: metadata(file),
      onChange: (box) => { void toggleSource(file, box); },
    }));
  }
  $('source-list').replaceChildren(...rows);
  $('source-list').setAttribute('aria-busy', String(state.sourceLoading));
  $('source-more').hidden = state.sourceNext === null;
  $('source-more').disabled = state.sourceLoading;
  const count = state.selected.size + (state.chatSelected ? 1 : 0);
  $('source-count').textContent = `${count} selected`;
  $('selected-files').hidden = !state.selected.size;
  $('selected-files-title').textContent = `${state.selected.size} selected file${state.selected.size === 1 ? '' : 's'} across folders`;
  $('selected-file-list').replaceChildren(...[...state.selected.keys()].map((path) => {
    const row = make('li');
    const remove = make('button', 'text-button', 'Remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${path}`);
    remove.addEventListener('click', () => { state.selected.delete(path); paintSources(); });
    row.append(make('span', null, path), remove);
    return row;
  }));
  $('source-hint').textContent = message
    ?? (!state.context?.directory ? 'Finding the session home folder...' : state.sourceLoading ? 'Opening folder...' : state.sourceChecks.size ? 'Reading selected file...'
      : !state.entries.length ? 'This folder is empty. Open another folder or add a document here.'
        : !count ? 'Open a folder or tick a file to use it. No files are selected automatically.' : '');
}

const tooMuch = () => paintSources('That is too much text at once. Untick another source first.');

async function toggleSource(file, box) {
  if (!box.checked) { state.selected.delete(file.path); paintSources(); return; }
  const epoch = state.epoch;
  state.sourceChecks.add(file.path);
  paintSources();
  try {
    const result = await rpc('GET', `/source?${query({ path: file.path })}`);
    if (epoch !== state.epoch) return;
    if (result.error || !Number.isFinite(result.characters)) {
      state.sourceErrors.set(file.path, result.error || 'Studio could not read this file. Use Refresh to try again.');
    } else if (selectedSize() + result.characters > LIMITS.source || state.selected.size >= LIMITS.sources) {
      state.sourceChecks.delete(file.path);
      tooMuch();
      return;
    } else {
      // Selections survive navigation, but never a new chat or reopening Studio.
      state.selected.set(file.path, result.characters);
    }
  } catch {
    if (epoch !== state.epoch) return;
    state.sourceErrors.set(file.path, 'Studio could not read this file. Use Refresh to try again.');
  }
  if (epoch !== state.epoch) return;
  state.sourceChecks.delete(file.path);
  paintSources();
}

function toggleChat(box) {
  if (box.checked && selectedSize() + chatSize() > LIMITS.source) { box.checked = false; tooMuch(); return; }
  state.chatSelected = box.checked;
  state.chatChoice = box.checked;
  paintSources();
}

// ---------- tiles and creating ----------

function paintTiles() {
  $('tiles').replaceChildren(...FORMATS.map((format) => {
    const meta = TILES[format.key];
    const tile = make('div', 'tile');
    tile.style.setProperty('--tile', meta.color);
    tile.dataset.disabled = String(!format.implemented);
    const main = make('button', 'tile-main');
    main.type = 'button';
    main.append(icon(format.key, 'tile-icon'), make('span', 'tile-name', meta.name), make('span', 'tile-blurb', meta.blurb));
    if (!format.implemented) {
      main.disabled = true;
      main.title = 'Coming soon';
    } else {
      main.dataset.format = format.key;
      main.addEventListener('click', () => openCustomize(format.key));
    }
    tile.append(main);
    return tile;
  }));
  paintAvailability();
}

function openCustomize(key, options = {}) {
  if (!hasWorkingAI()) { openSettings(true); return; }
  state.customizing = { ...options, key, choice: options.choice ?? defaultChoice(key) };
  $('customize-title').textContent = `Options for ${TILES[key].name}`;
  const choice = CHOICES[key];
  $('choice-group').hidden = !choice;
  if (choice) {
    $('choice-label').textContent = choice.label;
    const paintChips = () => $('choice-options').replaceChildren(...choice.options.map((option) => {
      const chip = make('button', 'chip', option.label);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(option.id === state.customizing.choice));
      chip.addEventListener('click', () => { state.customizing.choice = option.id; paintChips(); });
      return chip;
    }));
    paintChips();
  }
  $('choice-hint').textContent = choice ? 'Numbers are targets; the result depends on the selected sources.'
    : key === 'xlsx' ? `Up to ${DOCUMENT_CAPS.sheets} data sheets plus Notes; ${DOCUMENT_CAPS.sheetColumns} columns and ${DOCUMENT_CAPS.sheetRows} rows per data sheet. Source values only.`
      : 'Add any focus or custom conditions before creating.';
  $('focus').value = options.focus ?? '';
  // Escape must not reuse a previous dialog's successful return value.
  $('customize').returnValue = 'cancel';
  $('customize').showModal();
  paintAvailability();
}

async function create(key, { choice, focus = '', paths, chat } = {}) {
  if (!hasWorkingAI()) { openSettings(true); return; }
  if (state.sourceChecks.size) { snack('Please wait for the selected file to finish reading.'); return; }
  const wanted = paths ?? [...state.selected.keys()];
  const withChat = chat ?? state.chatSelected;
  if (!wanted.length && !withChat) {
    paintSources('Tick at least one source to start.');
    $('source-list').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const epoch = state.epoch;
  const connection = state.connection ?? await connect();
  if (epoch !== state.epoch) return;
  const model = chosenModel();
  if (!connection || !model || !hasWorkingAI()) { openSettings(true); return; }
  // Only paths travel; the service reads the files itself.
  const input = {
    id: crypto.randomUUID(), format: key, sources: wanted.map((path) => ({ path })), chat: Boolean(withChat), instructions: focus.trim(), choice: choice ?? defaultChoice(key),
    model: model.ref, context: selectionContext(state.context, state.agentPref, state.modelPref), secondPass: state.secondPass,
  };
  try {
    const record = await rpc('POST', '/jobs', input);
    if (epoch !== state.epoch) return;
    trackActive(record);
  } catch (error) {
    if (epoch !== state.epoch) return;
    if (error.code === 'BUSY') snack('Studio is already making 3 things. Try again when one is done.');
    else if (['NO_AGENT', 'NO_MODEL', 'AI_SELECTION_REQUIRED'].includes(error.code)) {
      state.connection = null;
      notice('The AI selection is no longer available. Choose an agent and model to continue.');
      paintSettings();
      openSettings(true);
      void connect();
    }
    else if (error.code === 'SOURCE_TOO_LARGE') paintSources('That is too much text at once. Untick a file and try again.');
    else {
      // The request may have arrived even though the reply was lost; history shows the truth.
      await refreshHistory();
      if (!state.rows.some((row) => row.id === input.id)) snack('Studio could not start that. Please try again.');
    }
  }
}

// ---------- creations list and polling ----------

function trackActive(record) {
  state.rows = [record, ...state.rows.filter((row) => row.id !== record.id)];
  if (['queued', 'running'].includes(record.status)) state.active.set(record.id, record);
  paintCreations();
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  if (state.active.size) state.pollTimer = setTimeout(() => { void poll(); }, 1500);
}

async function poll() {
  const epoch = state.epoch;
  for (const id of [...state.active.keys()]) {
    try {
      const record = await rpc('GET', `/jobs/${id}?${query()}`);
      if (epoch !== state.epoch) return;
      if (['queued', 'running'].includes(record.status)) continue;
      state.active.delete(id);
      state.rows = state.rows.map((row) => (row.id === id ? record : row));
      if (record.status === 'completed' && state.viewer?.record.id !== id) {
        snack(`Your ${NOUNS[record.format]} ${['flashcards', 'pptx'].includes(record.format) ? 'are' : 'is'} ready.`, { label: 'Open', run: () => openViewer(record) });
      }
    } catch { /* Keep polling; a lost reply is not a failed job. */ }
  }
  paintCreations();
  schedulePoll();
}

async function refreshHistory(append = false) {
  const epoch = state.epoch;
  if (!state.context?.directory) return;
  try {
    const result = await rpc('GET', `/jobs?${query()}&offset=${append ? state.next ?? 0 : 0}`);
    if (epoch !== state.epoch) return;
    state.rows = append ? [...state.rows, ...result.jobs] : result.jobs;
    state.next = result.next;
    for (const row of result.jobs) if (row.canCancel) state.active.set(row.id, row);
    paintCreations();
    schedulePoll();
  } catch { /* History is retried on the next refresh. */ }
}

function rowText(row) {
  const noun = NOUNS[row.format] ?? 'item';
  const count = (row.sources?.length ?? 1) + (row.chat ? 1 : 0);
  const base = `${TILES[row.format]?.name ?? row.format} · ${sourcesLabel(count)} · ${timeAgo(row.createdAt)}`;
  if (row.status === 'completed') return { title: row.title || TILES[row.format].name, sub: base };
  if (['queued', 'running'].includes(row.status)) return { title: `Making your ${noun}...`, sub: `${sourcesLabel(count)} · This can take a few minutes` };
  if (row.status === 'cancelled') return { title: `You stopped this ${noun}`, sub: `${base} · Tap to make it again` };
  return { title: `Couldn't make this ${noun}`, sub: `${base} · Tap to try again` };
}

function paintCreations() {
  const list = $('creations');
  list.replaceChildren(...state.rows.map((row) => {
    const item = make('li', 'creation');
    item.dataset.status = row.status;
    const button = make('button', 'creation-main');
    button.type = 'button';
    const bubble = icon(row.format, 'creation-icon');
    bubble.style.setProperty('--tile', TILES[row.format]?.color ?? '#888');
    const { title, sub } = rowText(row);
    const text = make('span', 'creation-text');
    text.append(make('span', 'creation-title', title), make('span', 'creation-sub', sub));
    button.append(bubble, text);
    const running = ['queued', 'running'].includes(row.status);
    if (running) button.append(make('span', 'spinner'));
    button.addEventListener('click', () => {
      if (row.status === 'completed') void openRecord(row.id);
      else if (!running) void retry(row.id);
    });
    item.append(button);
    if (running && row.canCancel !== false) {
      const stop = make('button', 'icon-button');
      stop.type = 'button';
      stop.setAttribute('aria-label', 'Stop');
      stop.title = 'Stop';
      stop.append(icon('stop', 'icon small'));
      stop.addEventListener('click', () => { void stopJob(row.id); });
      item.append(stop);
    }
    return item;
  }));
  $('creations-empty').hidden = state.rows.length > 0;
  $('more').hidden = state.next === null;
}

async function stopJob(id) {
  try {
    const record = await rpc('POST', `/jobs/${id}/cancel`, { context: state.context });
    state.active.delete(id);
    state.rows = state.rows.map((row) => (row.id === id ? record : row));
    paintCreations();
  } catch { await refreshHistory(); }
}

async function retry(id) {
  try {
    const record = await rpc('GET', `/jobs/${id}?${query()}`);
    // A previous job's sources need not be in the currently open folder. The service
    // revalidates every path and reports a missing file instead of silently substituting one.
    const paths = (record.sources ?? [record.source]).map((source) => source.path);
    const chat = Boolean(record.chat) && Boolean(state.chat?.available);
    openCustomize(record.format, { choice: record.choice ?? undefined, focus: record.instructions ?? '', ...(paths.length || chat ? { paths, chat } : {}) });
  } catch { snack('Studio could not start that. Please try again.'); }
}

// ---------- viewer ----------

async function openRecord(id) {
  try { openViewer(await rpc('GET', `/jobs/${id}?${query()}`)); }
  catch { snack('That one could not be opened. Please try again.'); }
}

function openViewer(record) {
  closeViewer();
  if (!record.artifact && !record.markdown) { void openRecord(record.id); return; }
  const handle = renderViewer($('viewer-body'), record, {
    host, status: (text) => snack(text),
    saveProgress: (value) => { void rpc('POST', `/jobs/${record.id}/progress`, { context: state.context, progress: value }).catch(() => {}); },
  });
  state.viewer = { record, handle };
  $('viewer-title').textContent = record.title || TILES[record.format].name;
  const save = $('viewer-save');
  save.replaceChildren(icon('save', 'icon small'), make('span', null, 'Save'));
  save.title = 'Save a copy in your project folder';
  save.onclick = () => { void saveRecord(record); };
  paintFacts(record);
  $('viewer-details').open = false;
  $('viewer').hidden = false;
  $('studio').hidden = true;
  $('viewer-back').focus();
}

function closeViewer() {
  state.viewer?.handle.dispose();
  state.viewer = null;
  $('viewer-body').replaceChildren();
  $('viewer').hidden = true;
  $('studio').hidden = false;
}

function paintFacts(record) {
  const facts = [
    ['Made from', [...(record.sources ?? [record.source]).map((source) => source.path), ...(record.chat ? ['this chat'] : [])].join(', ')],
    ['Made', new Date(record.completedAt ?? record.createdAt).toLocaleString()],
    ['AI model', modelName(record.model)],
    ...(record.agent ? [['AI agent', record.agent]] : []),
  ];
  const tries = record.attempts ?? [];
  if (typeof record.secondPass === 'boolean') facts.push(['Second pass', record.secondPass ? 'Reviewed and revised before delivery.' : 'Off for this creation.']);
  if (tries.length > 1) {
    const switched = tries.some((attempt) => attempt.model.id !== record.requestedModel?.id);
    // Draft, review and revision are successful stages, not failed attempts or retries.
    const retries = tries.filter(attempt => attempt.outcome !== 'completed').length;
    facts.push(['Behind the scenes', `${tries.length} AI calls${retries ? `, including ${retries} retr${retries === 1 ? 'y' : 'ies'}` : ''}${switched ? `; finished with ${modelName(record.model)}` : ''}.`]);
  }
  if (record.chat?.how === 'compressed') {
    const length = Number.isFinite(record.chat.fullWords) ? `${record.chat.fullWords.toLocaleString()} words`
      : `${record.chat.fullCharacters?.toLocaleString() ?? 'many'} characters`;
    facts.push(['This chat', `It was long (${length}), so OpenCode shortened it to its key points first, using the chat's own model.`]);
  }
  if (record.file?.pages) facts.push(['Size', `${record.file.pages} ${record.format === 'pdf' ? 'pages' : record.format === 'pptx' ? 'slides' : 'sheets'}`]);
  if (record.savedPath) facts.push(['Last saved as', record.savedPicture ? `${record.savedPicture} and ${record.savedPath}` : record.savedPath]);
  for (const note of record.notes ?? []) facts.push(['Changed', note]);
  $('viewer-facts').replaceChildren(...facts.flatMap(([term, value]) => [make('dt', null, term), make('dd', null, value)]));
}

async function saveRecord(record) {
  const button = $('viewer-save');
  button.disabled = true;
  try {
    const { savedPath } = await rpc('POST', `/jobs/${record.id}/save`, { context: state.context });
    record.savedPath = savedPath;
    const picture = record.format === 'infographic' ? await savePicture(record) : null;
    paintFacts(record);
    snack(picture ? `Saved the picture "${picture}" in your project folder, with a copy that stays sharp at any size.` : `Saved as "${savedPath}" in your project folder.`);
  } catch { snack('Saving did not work. Please try again.'); }
  finally { button.disabled = false; }
}

// The PNG is drawn here (its text needs a browser) and sent in bridge-sized pieces.
// If anything fails, the SVG that was already saved still stands; nothing is shown.
async function savePicture(record) {
  try {
    const data = await pictureBase64(record.artifact.svg);
    const upload = crypto.randomUUID();
    const size = 45_000;
    const total = Math.ceil(data.length / size);
    let result;
    for (let index = 0; index < total; index += 1) {
      result = await rpc('POST', `/jobs/${record.id}/picture`, { context: state.context, upload, index, total, data: data.slice(index * size, (index + 1) * size) });
    }
    record.savedPicture = result.savedPath;
    return result.savedPath;
  } catch (error) {
    // The SVG is already saved; the picture is a bonus, so only the console hears about it.
    console.error('Studio could not save the PNG picture:', error);
    return null;
  }
}

// ---------- settings ----------

function paintSettings() {
  const select = $('model-select');
  const models = state.connection?.models ?? [];
  const agents = state.connection?.agents ?? [];
  const draft = state.settingsDraft ?? { agent: state.agentPref, model: state.modelPref, secondPass: state.secondPass };
  const agentSelect = $('agent-select');
  const agent = state.connection?.agent;
  const placeholder = Object.assign(make('option', null, 'Select an agent'), { value: '', disabled: true });
  const automatic = Object.assign(make('option', null, `Use session/project defaults${agent ? ` (${agent})` : ''}`), { value: 'auto', disabled: !agent });
  agentSelect.replaceChildren(placeholder, automatic, ...agents.map(entry => Object.assign(make('option', null, entry.label || entry.id), { value: entry.id })));
  agentSelect.value = draft.agent === 'auto' ? (agent ? 'auto' : '') : agents.some(entry => entry.id === draft.agent) ? draft.agent : '';
  agentSelect.disabled = state.selectionPending || !agents.length;
  // Preview the draft agent's default, not a previously confirmed Studio model override.
  const inheritedRef = draft.agent === 'auto' ? state.context?.model : agents.find(entry => entry.id === draft.agent)?.model;
  const inherited = models.find(entry => entry.ref.providerID === inheritedRef?.providerID && entry.ref.id === inheritedRef?.id
    && (entry.ref.variant ?? '') === (inheritedRef?.variant ?? ''))
    ?? (draft.agent === 'auto' && state.agentPref === 'auto' && state.modelPref === 'auto' ? resolveModel(state.connection) : null);
  const auto = make('option', null, `Automatic${inherited ? ` (${inherited.label})` : ''}`);
  auto.value = 'auto';
  select.replaceChildren(auto, ...models.map((model) => Object.assign(make('option', null, model.label), { value: model.key })));
  select.value = draft.model === 'auto' || models.some(model => model.key === draft.model) ? draft.model : '';
  select.disabled = state.selectionPending || !models.length;
  $('settings-title').textContent = hasWorkingAI() ? 'Settings' : 'Choose an AI agent';
  $('selection-help').textContent = state.selectionPending ? 'Loading available agents and models...'
    : state.connectionError
      || (!agents.length ? 'No available agents were found. Configure an agent in OpenChamber, then refresh this list.'
        : !models.length ? 'No available text models were found. Configure a model in OpenChamber, then refresh this list.'
          : state.connection?.selectionError || (hasWorkingAI() ? 'Choose the AI selection used by Studio. This does not change your chat.'
            : 'Select an available agent and model. Creation stays disabled until the selection is valid.'));
  $('agent-line').textContent = agent ? `Selected agent: ${agent}. Studio generates without agent tools.` : 'No available agent is selected.';
  $('second-pass').checked = draft.secondPass !== false;
  $('second-pass').disabled = state.selectionPending;
  $('settings-apply').disabled = state.selectionPending || !agentSelect.value || !models.length || !select.value;
  $('settings-apply').textContent = state.selectionPending ? 'Checking...' : hasWorkingAI() ? 'Save settings' : 'Use selection';
  $('settings-refresh').disabled = state.selectionPending;
  paintAvailability();
}

function openSettings(required = false) {
  if (required) state.selectionPrompted = true;
  if (!$('settings').open) {
    state.settingsDraft = { agent: state.agentPref, model: state.modelPref, secondPass: state.secondPass };
    $('settings').returnValue = 'cancel';
    paintSettings();
    $('settings').showModal();
  } else paintSettings();
}

async function applySettings() {
  if ($('settings-apply').disabled) return;
  const epoch = state.epoch;
  state.agentPref = $('agent-select').value;
  state.modelPref = $('model-select').value;
  state.secondPass = $('second-pass').checked;
  state.preferenceRevision += 1;
  state.connectionEpoch += 1;
  const revision = state.connectionEpoch;
  state.connecting = null;
  state.connection = null;
  await connect();
  if (epoch !== state.epoch || revision !== state.connectionEpoch) return;
  if (hasWorkingAI()) {
    void remember('agent', state.agentPref);
    void remember('model', state.modelPref);
    void remember('second-pass', state.secondPass);
    $('settings').close('applied');
    state.settingsDraft = null;
    paintSettings();
  }
}

// ---------- wiring ----------

function mount() {
  installPanelFont();
  $('open-settings').append(icon('gear'));
  $('viewer-back').append(icon('back'));
  $('viewer-back').addEventListener('click', closeViewer);
  $('source-up').append(icon('up', 'icon small'));
  $('source-direction').append(icon('sort', 'icon small'));
  $('source-refresh').append(icon('retry', 'icon small'));
  $('source-home').addEventListener('click', () => { void loadSources({ folder: '' }); });
  $('source-up').addEventListener('click', () => { void loadSources({ folder: state.sourceFolder.split('/').slice(0, -1).join('/') }); });
  $('source-refresh').addEventListener('click', () => {
    state.sourceErrors.clear();
    void loadSources();
    void loadChat();
    if (!state.connection) void connect();
  });
  $('source-sort').addEventListener('change', (event) => { state.sourceSort = event.target.value; void loadSources(); });
  $('source-direction').addEventListener('click', () => {
    state.sourceDirection = state.sourceDirection === 'asc' ? 'desc' : 'asc';
    void loadSources();
  });
  $('source-more').addEventListener('click', () => { void loadSources({ append: true }); });
  $('more').addEventListener('click', () => { void refreshHistory(true); });
  $('open-settings').addEventListener('click', () => openSettings());
  $('agent-select').addEventListener('change', (event) => {
    state.settingsDraft = { ...state.settingsDraft, agent: event.target.value, model: 'auto' };
    paintSettings();
  });
  $('model-select').addEventListener('change', (event) => {
    state.settingsDraft = { ...state.settingsDraft, agent: $('agent-select').value || 'auto', model: event.target.value };
    paintSettings();
  });
  $('second-pass').addEventListener('change', (event) => {
    state.settingsDraft = { ...state.settingsDraft, agent: $('agent-select').value || 'auto', model: $('model-select').value || 'auto', secondPass: event.target.checked };
  });
  $('settings-apply').addEventListener('click', () => { void applySettings(); });
  $('settings-refresh').addEventListener('click', () => {
    state.connectionEpoch += 1;
    state.connecting = null;
    void connect();
  });
  $('settings').addEventListener('close', () => { state.settingsDraft = null; });
  $('customize').addEventListener('close', () => {
    const pending = state.customizing;
    state.customizing = null;
    if ($('customize').returnValue === 'go' && pending) void create(pending.key, { ...pending, focus: $('focus').value });
  });
  // The sandboxed frame blocks form submission, so dialog buttons close their dialog directly.
  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close(button.dataset.close));
  }
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.viewer) closeViewer(); });
  paintTiles();
  paintSettings();
}

async function initializeContext(next) {
  const epoch = state.epoch;
  const connectionEpoch = state.connectionEpoch;
  try {
    // The host can have a composer but no saved session yet. Resolve its home/defaults
    // through our local service rather than demanding a first message or creating a chat.
    const resolved = await rpc('GET', `/context?${contextQuery(next)}`);
    if (epoch !== state.epoch || connectionEpoch !== state.connectionEpoch) return;
    state.context = { ...next, ...resolved };
    state.connectionError = null;
    paintSources();
    paintSettings();
    // A newer model snapshot can supersede the very first context request. Initialization
    // belongs to the chat scope, not to whichever request happened to start first.
    if (!state.initialized) {
      const revision = state.preferenceRevision;
      const [agent, model, secondPass] = await Promise.all([recall('agent'), recall('model'), recall('second-pass')]);
      if (epoch !== state.epoch || connectionEpoch !== state.connectionEpoch || revision !== state.preferenceRevision) return;
      state.agentPref = typeof agent === 'string' && agent ? agent : 'auto';
      state.modelPref = typeof model === 'string' && modelFromKey(model) ? model : 'auto';
      state.secondPass = secondPass !== false;
      state.initialized = true;
      paintSettings();
      void loadSources({ folder: '' });
      void refreshHistory();
    }
    void loadChat();
    void connect();
  } catch (error) {
    if (epoch !== state.epoch || connectionEpoch !== state.connectionEpoch) return;
    state.connectionError = error.message || 'Studio could not find the session folder. Retrying...';
    notice(state.connectionError);
    paintSettings();
    state.retryTimer = setTimeout(() => {
      if (epoch === state.epoch && connectionEpoch === state.connectionEpoch) void initializeContext(next);
    }, 3000);
  }
}

function applyContext(ctx) {
  const next = hostContext(ctx, new URL(window.location.href).origin);
  const scope = JSON.stringify([next.directory, next.sessionId, next.hostOrigin]);
  const selection = JSON.stringify([next.model ?? null, next.agent ?? null]);
  const reset = scope !== state.hostScope;
  const wasBusy = state.sessionBusy;
  state.sessionBusy = Boolean(ctx.session?.busy);
  if (!reset && selection === state.hostSelection) {
    if (wasBusy && !state.sessionBusy) void loadChat();
    return;
  }
  state.hostScope = scope;
  state.hostSelection = selection;
  state.connectionEpoch += 1;
  clearTimeout(state.retryTimer);
  Object.assign(state, { context: next, connection: null, connectionError: null, connecting: null, selectionPending: true, retryDelay: 2000 });
  if (reset) {
    clearTimeout(state.pollTimer);
    clearTimeout(state.sourceTimer);
    clearTimeout(state.chatTimer);
    closeViewer();
    if ($('customize').open) $('customize').close('cancel');
    Object.assign(state, {
      epoch: state.epoch + 1, initialized: false, modelPref: 'auto', agentPref: 'auto', secondPass: true, selectionPrompted: false,
      settingsDraft: null, preferenceRevision: state.preferenceRevision + 1,
      entries: [], selected: new Map(), sourceFolder: '', sourceNext: null, sourceTotal: 0, sourceLoading: false,
      sourceChecks: new Set(), sourceErrors: new Map(), chat: null, chatSelected: false, chatChoice: null,
      rows: [], next: null, active: new Map(),
    });
  }
  paintSources();
  paintCreations();
  paintSettings();
  notice(null);
  void initializeContext(next);
}

let mounted = false;
let latestSnapshot = null;
host.onReady((ctx) => {
  latestSnapshot = ctx;
  applyHostReady(ctx, document.documentElement);
  if (!mounted) { mount(); mounted = true; }
  applyContext(ctx);
});
// The SDK's individual pushes do not re-emit onReady. Listen to them as well so a
// model switch or first message is visible without closing and reopening Studio.
host.onDirectory((directory) => {
  if (!latestSnapshot) return;
  latestSnapshot = { ...latestSnapshot, directory };
  applyContext(latestSnapshot);
});
host.onSession((session) => {
  if (!latestSnapshot) return;
  latestSnapshot = { ...latestSnapshot, session };
  applyContext(latestSnapshot);
});
host.onSessionLifecycle((event) => {
  if (event.sessionId === state.context?.sessionId && event.phase === 'completed') void loadChat();
});

window.addEventListener('pagehide', () => {
  clearTimeout(state.pollTimer);
  clearTimeout(state.retryTimer);
  clearTimeout(state.sourceTimer);
  clearTimeout(state.chatTimer);
  state.epoch += 1;
  state.viewer?.handle.dispose();
  host.dispose();
});
