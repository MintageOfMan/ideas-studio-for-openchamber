import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CHAT_SUMMARY_CHARACTER_LIMIT, CHAT_WORD_LIMIT, countWords } from '../shared/common/sources.mjs';
import { chatSource, measureChat, transcript } from '../shared/service/chat.mjs';

const words = (count, word = 'word') => Array(count).fill(word).join(' ');
// The transcript's "User:" label is one of its whitespace-separated tokens.
const conversation = (count, word) => [{ type: 'user', text: words(count - 1, word) }];
const md5 = (text) => createHash('md5').update(text).digest('hex');

test('word counts use whitespace, including Unicode separators, rather than character length', () => {
  assert.equal(CHAT_WORD_LIMIT, 25_000);
  assert.equal(CHAT_SUMMARY_CHARACTER_LIMIT, 150_000);
  assert.equal(countWords(''), 0);
  assert.equal(countWords(' \t\r\n\v\f\u00a0\u2003\u2028\u2029\ufeff\u3000'), 0);
  assert.equal(countWords(' one\ttwo\r\nthree\vfour\ffive\u00a0six\u2003seven\u2028eight\u2029nine\ufefften\u3000eleven '), 11);
  assert.equal(countWords('read-only café 中文 😀 one\u200btwo'), 5);
  assert.equal(countWords('x'.repeat(200_000)), 1);
});

test('transcripts preserve completed summaries, recent context and roles, without tool or reasoning parts', () => {
  const messages = [
    { type: 'compaction', status: 'pending', summary: 'unfinished summary' },
    { type: 'compaction', status: 'completed', summary: ' Earlier facts. ', recent: ' Recent facts. ' },
    { type: 'user', text: ' What next? ' },
    { type: 'assistant', content: [
      { type: 'reasoning', text: 'private reasoning' },
      { type: 'tool', name: 'shell', text: 'tool details' },
      { type: 'text', text: ' First answer. ' },
      { type: 'text', text: ' Second answer. ' },
    ] },
    { type: 'tool', text: 'tool result' },
  ];
  assert.equal(transcript(messages), 'Earlier in this chat (summary):\nEarlier facts. \n\n Recent facts.\n\nUser: What next?\n\nAssistant: First answer.\nSecond answer.');
});

test('chats through 25,000 words keep every character and never request a summary', async () => {
  const cases = [
    conversation(CHAT_WORD_LIMIT - 1),
    conversation(CHAT_WORD_LIMIT),
    [{ type: 'user', text: 'x'.repeat(210_000) }],
  ];
  for (const messages of cases) {
    const full = transcript(messages);
    const connection = {
      chatContext: async () => messages,
      summarizeChat: async () => assert.fail('uncompressed chats must not call the model'),
    };
    assert.ok(full.length > 10_000);
    assert.deepEqual(await measureChat(connection), { available: true, characters: full.length, words: countWords(full), compressed: false });
    assert.deepEqual(await chatSource(connection), { content: full, how: 'full', characters: full.length, words: countWords(full), md5: md5(full) });
  }
});

test('25,001 words reserve the bounded character budget; only generation requests a summary', async () => {
  for (const word of ['x', 'longword']) {
    const messages = conversation(CHAT_WORD_LIMIT + 1, word);
    const full = transcript(messages);
    const characterLimit = Math.min(full.length, CHAT_SUMMARY_CHARACTER_LIMIT);
    const signal = new AbortController().signal;
    let calls = 0;
    const connection = {
      chatContext: async () => messages,
      summarizeChat: async (prompt, receivedSignal) => {
        calls += 1;
        assert.match(prompt, /at most 20,000 words/);
        assert.ok(prompt.includes(`at most ${characterLimit.toLocaleString('en-US')} characters`));
        assert.equal(receivedSignal, signal);
        return 'Key facts.\n\nNext steps.';
      },
    };
    const measured = { available: true, characters: characterLimit, words: CHAT_WORD_LIMIT + 1, compressed: true };
    assert.deepEqual(await measureChat(connection), measured);
    assert.deepEqual(await measureChat(connection), measured);
    assert.equal(calls, 0, 'opening or refreshing the source list is read-only');
    const summary = await chatSource(connection, signal);
    assert.equal(calls, 1);
    assert.deepEqual(summary, {
      content: 'Key facts.\n\nNext steps.', how: 'compressed', characters: 'Key facts.\n\nNext steps.'.length,
      words: 4, md5: md5(full), fullCharacters: full.length, fullWords: CHAT_WORD_LIMIT + 1,
    });
  }
});

test('a summary at 25,000 words is accepted intact; one more word is rejected even within its character budget', async () => {
  const messages = conversation(CHAT_WORD_LIMIT + 1, 'x');
  const withinLimit = words(CHAT_WORD_LIMIT, 'x');
  const tooManyWords = words(CHAT_WORD_LIMIT + 1, 'x');
  const connection = (summary) => ({ chatContext: async () => messages, summarizeChat: async () => summary });
  const accepted = await chatSource(connection(withinLimit));
  assert.equal(accepted.words, CHAT_WORD_LIMIT);
  assert.equal(accepted.content, withinLimit);
  assert.ok(tooManyWords.length < transcript(messages).length);
  await assert.rejects(chatSource(connection(tooManyWords)), { code: 'CHAT_SUMMARY_FAILED' });
});

test('summary character limits use the smaller of the original length and 150,000, rejecting rather than truncating', async () => {
  for (const word of ['x', 'longword']) {
    const messages = conversation(CHAT_WORD_LIMIT + 1, word);
    const characterLimit = Math.min(transcript(messages).length, CHAT_SUMMARY_CHARACTER_LIMIT);
    const connection = (summary) => ({ chatContext: async () => messages, summarizeChat: async () => summary });
    const summary = 's'.repeat(characterLimit);
    const accepted = await chatSource(connection(summary));
    assert.equal(accepted.content, summary);
    assert.equal(accepted.characters, characterLimit);
    assert.equal(accepted.words, 1);
    await assert.rejects(chatSource(connection(`${summary}s`)), { code: 'CHAT_SUMMARY_FAILED' });
  }
});

test('empty and failed summaries fail once, while cancellation keeps its original error', async () => {
  const messages = conversation(CHAT_WORD_LIMIT + 1);
  for (const summary of ['', ' \t\r\n', undefined]) {
    let calls = 0;
    await assert.rejects(chatSource({
      chatContext: async () => messages,
      summarizeChat: async () => { calls += 1; return summary; },
    }), { code: 'CHAT_SUMMARY_FAILED' });
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(chatSource({
    chatContext: async () => messages,
    summarizeChat: async () => { calls += 1; throw new Error('transport failed'); },
  }), { code: 'CHAT_SUMMARY_FAILED' });
  assert.equal(calls, 1);

  const controller = new AbortController();
  const cancelled = new Error('cancelled');
  await assert.rejects(chatSource({
    chatContext: async () => messages,
    summarizeChat: async () => { controller.abort(); throw cancelled; },
  }, controller.signal), (error) => error === cancelled);
});
