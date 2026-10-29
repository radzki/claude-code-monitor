import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLastAssistantMessage, readTranscriptInfo } from '../src/utils/transcript.js';

const TEST_DIR = join(tmpdir(), `claude-monitor-transcript-test-${process.pid}`);
const TRANSCRIPT = join(TEST_DIR, 'session.jsonl');

const assistant = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

function writeTranscript(entries: unknown[]): void {
  writeFileSync(TRANSCRIPT, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

describe('transcript', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('readTranscriptInfo', () => {
    it('returns an empty result for a missing file', () => {
      expect(readTranscriptInfo(join(TEST_DIR, 'missing.jsonl'))).toEqual({});
    });

    it('reads the AI-generated title (Claude Code v2.1.30+)', () => {
      writeTranscript([
        { type: 'user', message: { role: 'user', content: 'fix the bar' } },
        { type: 'ai-title', aiTitle: 'Fix stale statusline branch', sessionId: 's1' },
        assistant('Done.'),
      ]);
      expect(readTranscriptInfo(TRANSCRIPT)).toEqual({
        lastMessage: 'Done.',
        title: 'Fix stale statusline branch',
      });
    });

    it('uses the latest AI title when it is regenerated', () => {
      writeTranscript([
        { type: 'ai-title', aiTitle: 'Old title', sessionId: 's1' },
        assistant('one'),
        { type: 'ai-title', aiTitle: 'New title', sessionId: 's1' },
      ]);
      expect(readTranscriptInfo(TRANSCRIPT).title).toBe('New title');
    });

    it('prefers a /rename title over the AI title, wherever it appears', () => {
      writeTranscript([
        { type: 'custom-title', customTitle: 'My name', sessionId: 's1' },
        assistant('one'),
        { type: 'ai-title', aiTitle: 'Generated', sessionId: 's1' },
      ]);
      expect(readTranscriptInfo(TRANSCRIPT).title).toBe('My name');
    });

    it('falls back to a summary entry', () => {
      writeTranscript([{ type: 'summary', summary: 'Legacy summary' }, assistant('hi')]);
      expect(readTranscriptInfo(TRANSCRIPT).title).toBe('Legacy summary');
    });

    it('has no title when the transcript carries none', () => {
      writeTranscript([assistant('hi')]);
      expect(readTranscriptInfo(TRANSCRIPT)).toEqual({ lastMessage: 'hi', title: undefined });
    });

    it('ignores blank titles and invalid lines', () => {
      writeFileSync(
        TRANSCRIPT,
        [
          JSON.stringify({ type: 'ai-title', aiTitle: 'Real title' }),
          '{not json "type":"ai-title"',
          JSON.stringify({ type: 'ai-title', aiTitle: '   ' }),
        ].join('\n')
      );
      expect(readTranscriptInfo(TRANSCRIPT).title).toBe('Real title');
    });
  });

  describe('getLastAssistantMessage', () => {
    it('returns the last assistant text', () => {
      writeTranscript([assistant('first'), { type: 'user' }, assistant('second')]);
      expect(getLastAssistantMessage(TRANSCRIPT)).toBe('second');
    });
  });
});
