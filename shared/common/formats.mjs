import { LIMITS, requireJobId, sourcesOf, StudioError, validSourcePath } from './core.mjs';
import { CHAT_SOURCE, CHAT_WORD_LIMIT, countWords } from './sources.mjs';
import { DOCUMENT_CAPS, docx, pdf, pptx, xlsx } from './documents.mjs';
import { flashcards } from './flashcards.mjs';
import { infographic } from './infographic.mjs';
import { mindmap } from './mindmap.mjs';
import { quiz } from './quiz.mjs';
import { summary } from './summary.mjs';
import { webpage } from './webpage.mjs';

const planned = (key, label, reason) => Object.freeze({ key, label, implemented: false, reason });

// Keep the established creation-grid order consistent across the panel and service.
export const FORMATS = Object.freeze([
  summary,
  docx,
  pptx,
  xlsx,
  webpage,
  pdf,
  mindmap,
  flashcards,
  quiz,
  planned('podcast', 'Podcast', 'Not built yet: needs the optional Kokoro audio pack.'),
  infographic,
]);

export const IMPLEMENTED = Object.freeze(FORMATS.filter((format) => format.implemented));

export function formatFor(key) {
  const format = IMPLEMENTED.find((entry) => entry.key === key);
  if (!format) throw new StudioError('BAD_FORMAT', 'Choose a format this build implements.');
  return format;
}

export const labelFor = (key) => FORMATS.find((entry) => entry.key === key)?.label ?? String(key);

// One simple choice per format in Options. Keep option and default IDs stable for saved
// history. The option marked `default` is preselected; `hint` is what the model is told.
const choice = (label, options) => Object.freeze({ label, options: Object.freeze(options) });
const sections = (maximum) => choice('Length', [
  { id: 'short', count: 3 }, { id: 'standard', count: 6, default: true }, { id: 'long', count: maximum },
].map(({ count, ...option }) => ({
  ...option, label: `Up to ${count} sections`,
  hint: `Length: up to ${count} sections. Use fewer if the source supports fewer; do not pad the document.`,
})));
const LENGTH = sections(DOCUMENT_CAPS.sections);
export const CHOICES = Object.freeze({
  summary: choice('Length', [
    { id: 'short', label: 'About 200 words', hint: 'Length: about 200 words. Use fewer if the source supports less; do not pad the summary.' },
    { id: 'standard', label: 'About 500 words', hint: 'Length: about 500 words. Use fewer if the source supports less; do not pad the summary.', default: true },
    { id: 'long', label: 'About 900 words', hint: 'Length: about 900 words. Use fewer if the source supports less; do not pad the summary.' },
  ]),
  docx: LENGTH, pdf: LENGTH, webpage: sections(10),
  pptx: choice('Length', [
    { id: 'short', label: 'Up to 6 slides total', hint: 'Length: up to 6 slides in total, including the 1 title slide added for you. Write at most 5 content slides; do not write the title slide. Use fewer if the source supports fewer.' },
    { id: 'standard', label: 'Up to 16 slides total', hint: 'Length: up to 16 slides in total, including the 1 title slide added for you. Write at most 15 content slides; do not write the title slide. Use fewer if the source supports fewer.', default: true },
  ]),
  flashcards: choice('Number of cards', [
    { id: 'fewer', label: 'Up to 8 cards', hint: 'Amount: up to 8 cards. Use fewer if the source supports fewer distinct questions; do not pad the deck.' },
    { id: 'standard', label: 'Up to 12 cards', hint: 'Amount: up to 12 cards. Use fewer if the source supports fewer distinct questions; do not pad the deck.', default: true },
    { id: 'more', label: 'Up to 20 cards', hint: 'Amount: up to 20 cards. Use fewer if the source supports fewer distinct questions; do not pad the deck.' },
  ]),
  quiz: choice('Difficulty', [
    { id: 'easy', label: 'Easy (up to 10 questions)', hint: 'Difficulty: easy. Amount: up to 10 questions, fewer if the source supports fewer. Test the main facts with clearly different options.' },
    { id: 'medium', label: 'Medium (up to 10 questions)', hint: 'Difficulty: medium. Amount: up to 10 questions, fewer if the source supports fewer. Test the main facts and links between them.', default: true },
    { id: 'hard', label: 'Hard (up to 10 questions)', hint: 'Difficulty: hard. Amount: up to 10 questions, fewer if the source supports fewer. Test fine distinctions and links between parts of the source.' },
  ]),
  infographic: choice('Detail', [
    { id: 'simple', label: 'Up to 4 items / 2 per group', hint: 'Detail: up to 4 list items, chart values or tree boxes (including the root). For comparison or SWOT layouts, use up to 2 items per group and keep the required number of groups. Stay within the chosen layout\'s minimum and maximum counts. Use only source-supported facts and keep descriptions very short.' },
    { id: 'detailed', label: 'Up to 8 items / 5 per group', hint: 'Detail: up to 8 list items, chart values or tree boxes (including the root). For comparison or SWOT layouts, use up to 5 items per group and keep the required number of groups. Stay within the chosen layout\'s minimum and maximum counts. Use fewer where the source supports fewer; do not invent facts to fill a layout.', default: true },
  ]),
  mindmap: choice('Detail', [
    { id: 'simple', label: 'Up to 4 branches, 2 levels', hint: 'Detail: up to 4 main branches and up to 2 levels below the title. Use fewer branches or levels if the source supports fewer.' },
    { id: 'standard', label: 'Up to 10 branches, 3 levels', hint: 'Detail: up to 10 main branches and up to 3 levels below the title. Use fewer branches or levels if the source supports fewer.', default: true },
  ]),
});

export const defaultChoice = (key) => CHOICES[key]?.options.find((option) => option.default)?.id ?? null;

// Checks what the panel sends: which files (by path), whether to add this chat, and the options.
// File text is read by the service; tests and older callers may still pass `content` inline.
export function validateRequest(input) {
  if (!input || typeof input !== 'object') throw new StudioError('BAD_INPUT', 'A Studio request is required.');
  requireJobId(input.id);
  const format = formatFor(input.format);
  const offered = sourcesOf(input);
  const chat = input.chat === true;
  if (!Array.isArray(offered) || (!offered.length && !chat)) throw new StudioError('BAD_SOURCE', 'Choose at least one source.');
  if (offered.length > LIMITS.sources) throw new StudioError('TOO_MANY_SOURCES', `Choose at most ${LIMITS.sources} files.`);
  const seen = new Set();
  const sources = offered.map((source) => {
    if (!validSourcePath(source?.path) || seen.has(source.path)) throw new StudioError('BAD_SOURCE', 'Choose supported files inside this project.');
    seen.add(source.path);
    if (source.content !== undefined && typeof source.content !== 'string') throw new StudioError('BAD_SOURCE', `${source.path} is not text.`);
    return source.content === undefined ? { path: source.path } : { path: source.path, content: source.content };
  });
  const instructions = input.instructions ?? '';
  if (typeof instructions !== 'string' || instructions.length > LIMITS.instructions) {
    throw new StudioError('BAD_INSTRUCTIONS', `Instructions must be at most ${LIMITS.instructions} characters.`);
  }
  const options = CHOICES[format.key]?.options ?? [];
  const picked = input.choice ?? defaultChoice(format.key);
  if (picked !== null && !options.some((option) => option.id === picked)) throw new StudioError('BAD_CHOICE', 'Choose one of the offered options.');
  const secondPass = input.secondPass === undefined ? true : input.secondPass;
  if (typeof secondPass !== 'boolean') throw new StudioError('BAD_SECOND_PASS', 'Second pass must be on or off.');
  if (!input.model || !['providerID', 'id'].every((key) => typeof input.model[key] === 'string' && input.model[key].length > 0 && input.model[key].length <= 200)
      || (input.model.variant !== undefined && (typeof input.model.variant !== 'string' || input.model.variant.length > 200))) {
    throw new StudioError('NO_MODEL', 'Select an available generation model.');
  }
  if (JSON.stringify(input).length > LIMITS.request) throw new StudioError('REQUEST_TOO_LARGE', 'The encoded request exceeds the host bridge limit. Nothing was truncated.');
  return {
    id: input.id, format: format.key, sources, chat, instructions, choice: picked, secondPass,
    model: { providerID: input.model.providerID, id: input.model.id, ...(input.model.variant ? { variant: input.model.variant } : {}) },
  };
}

// The full input for a model call, once every source's text is known. `sources` may include the
// chat (path CHAT_SOURCE). Over-limit input is refused; nothing is truncated.
export function validateJob(input) {
  const all = sourcesOf(input);
  const chatSource = all.find((source) => source.path === CHAT_SOURCE);
  const files = all.filter((source) => source.path !== CHAT_SOURCE);
  // The bridge-size check applies to what the panel sends, so it runs on paths only.
  const request = validateRequest({ ...input, source: undefined, sources: files.map(({ path }) => ({ path })), chat: Boolean(chatSource) });
  const sources = [...files, ...(chatSource ? [chatSource] : [])].map((source) => {
    const content = source.content;
    if (typeof content !== 'string' || !content.trim()) throw new StudioError('EMPTY_SOURCE', `${source.path === CHAT_SOURCE ? 'This chat' : source.path} is empty.`);
    if (content.includes('\0')) throw new StudioError('BAD_SOURCE', `${source.path} is not a plain text file.`);
    if (source.path === CHAT_SOURCE && countWords(content) > CHAT_WORD_LIMIT) throw new StudioError('CHAT_TOO_LARGE', 'The chat exceeds the 25,000-word limit.');
    return { path: source.path, content };
  });
  if (!sources.length) throw new StudioError('BAD_SOURCE', 'Choose at least one source.');
  const total = sources.reduce((sum, source) => sum + source.content.length, 0);
  if (total > LIMITS.source) {
    throw new StudioError('SOURCE_TOO_LARGE', `The selected sources have ${total.toLocaleString('en-US')} characters; this build accepts ${LIMITS.source.toLocaleString('en-US')}. Nothing was truncated; select fewer or smaller sources.`);
  }
  const options = CHOICES[request.format]?.options ?? [];
  return {
    ...request,
    sources,
    // Kept for callers that read one source: the first, or a combined label.
    source: sources.length === 1 ? sources[0] : { path: `${sources[0].path} + ${sources.length - 1} more`, content: sources.map((source) => source.content).join('\n\n') },
    preference: options.find((option) => option.id === request.choice)?.hint ?? '',
  };
}
