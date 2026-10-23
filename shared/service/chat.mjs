// The current chat as a source. Its available text is measured without a model call; the
// panel selects it by default. Only a selected chat enters a generation request. Small chats
// go as they are; larger ones go as compressed context (see chatSource).
import { createHash } from 'node:crypto';
import { StudioError } from '../common/core.mjs';
import { CHAT_SUMMARY_CHARACTER_LIMIT, CHAT_WORD_LIMIT, countWords } from '../common/sources.mjs';

const SUMMARY_WORD_TARGET = 20_000;

// Readable conversation text: the compaction summary, then user and assistant words.
// Reasoning, tool calls and tool output are left out; they are working notes, not the chat.
export function transcript(messages) {
  const lines = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.type === 'compaction' && message.status === 'completed') {
      const summary = [message.summary, message.recent].filter((text) => typeof text === 'string' && text.trim()).join('\n\n');
      if (summary) lines.push(`Earlier in this chat (summary):\n${summary.trim()}`);
    } else if (message?.type === 'user' && typeof message.text === 'string' && message.text.trim()) {
      lines.push(`User: ${message.text.trim()}`);
    } else if (message?.type === 'assistant' && Array.isArray(message.content)) {
      const text = message.content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text.trim()).filter(Boolean).join('\n');
      if (text) lines.push(`Assistant: ${text}`);
    }
  }
  return lines.join('\n\n').trim();
}

const summaryPrompt = (characters) => [
  'Write a compressed context of this whole conversation for someone who will turn it into study material.',
  'Keep every decision, fact, figure, name, open question and result that matters; drop chatter and repetition.',
  'Do not include private reasoning, tool calls or tool output.',
  `Use plain text with short paragraphs or bullet points. Use at most ${SUMMARY_WORD_TARGET.toLocaleString('en-US')} words (whitespace-separated tokens) and at most ${characters.toLocaleString('en-US')} characters.`,
  'Write only the summary.',
].join(' ');

// Measures the chat for the source list without any model call.
export async function measureChat(connection) {
  const text = transcript(await connection.chatContext());
  if (!text) return { available: false, reason: 'This chat has no messages yet.' };
  const words = countWords(text);
  const compressed = words > CHAT_WORD_LIMIT;
  return { available: true, characters: compressed ? Math.min(text.length, CHAT_SUMMARY_CHARACTER_LIMIT) : text.length, words, compressed };
}

// The text sent as the chat source, and how it was made:
// - full: the active context fits in CHAT_WORD_LIMIT. If OpenCode compacted the chat, that context
//   already starts with OpenCode's own summary.
// - compressed: OpenCode summarizes the session context (POST /api/session/:id/generate),
//   which uses the chat's model and may be billed, but never changes the chat.
export async function chatSource(connection, signal) {
  const full = transcript(await connection.chatContext());
  if (!full) throw new StudioError('EMPTY_CHAT', 'This chat has no messages yet.');
  const digest = createHash('md5').update(full).digest('hex');
  const fullWords = countWords(full);
  if (fullWords <= CHAT_WORD_LIMIT) return { content: full, how: 'full', characters: full.length, words: fullWords, md5: digest };
  const characterLimit = Math.min(full.length, CHAT_SUMMARY_CHARACTER_LIMIT);
  let summary;
  try { summary = (await connection.summarizeChat(summaryPrompt(characterLimit), signal))?.trim(); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw new StudioError('CHAT_SUMMARY_FAILED', 'Studio could not shorten this chat. Try again, or untick the chat.');
  }
  if (!summary) throw new StudioError('CHAT_SUMMARY_FAILED', 'Studio could not shorten this chat. Try again, or untick the chat.');
  const words = countWords(summary);
  if (words > CHAT_WORD_LIMIT || summary.length > characterLimit) throw new StudioError('CHAT_SUMMARY_FAILED', 'The shortened chat was still too long. Try again, or untick the chat.');
  return { content: summary, how: 'compressed', characters: summary.length, words, md5: digest, fullCharacters: full.length, fullWords };
}
