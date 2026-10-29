import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Build transcript file path from cwd and session_id.
 * Claude Code stores transcripts at ~/.claude/projects/{encoded-cwd}/{session_id}.jsonl
 */
export function buildTranscriptPath(cwd: string, sessionId: string): string {
  // Encode cwd: replace / and . with - (including leading /)
  const encodedCwd = cwd.replace(/[/.]/g, '-');
  return join(homedir(), '.claude', 'projects', encodedCwd, `${sessionId}.jsonl`);
}

interface ContentBlock {
  type: string;
  text?: string;
}

export interface TranscriptInfo {
  lastMessage?: string;
  title?: string;
}

// Title entries, most authoritative first: a /rename, Claude Code's generated
// title (v2.1.30+, which stopped updating sessions-index.json), and the older
// summary entries. Within a kind, the latest entry wins.
const TITLE_KINDS = [
  { type: 'custom-title', field: 'customTitle' },
  { type: 'ai-title', field: 'aiTitle' },
  { type: 'summary', field: 'summary' },
] as const;

/**
 * Read the last assistant text message and the session title from a transcript
 * file in one pass (from the end, so the latest entries win).
 */
export function readTranscriptInfo(transcriptPath: string): TranscriptInfo {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return {};
  }

  let lastMessage: string | undefined;
  const titles: (string | undefined)[] = TITLE_KINDS.map(() => undefined);

  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const kind = TITLE_KINDS.findIndex(
        (k, idx) => titles[idx] === undefined && line.includes(`"type":"${k.type}"`)
      );
      const wantsMessage = lastMessage === undefined && line.includes('"type":"assistant"');
      if (kind === -1 && !wantsMessage) continue;

      try {
        const entry = JSON.parse(line);
        if (kind !== -1 && entry.type === TITLE_KINDS[kind].type) {
          const value = entry[TITLE_KINDS[kind].field];
          if (typeof value === 'string' && value.trim()) {
            titles[kind] = value.trim();
          }
        }
        if (wantsMessage && entry.type === 'assistant' && entry.message?.content) {
          const contentBlocks = entry.message.content as ContentBlock[];

          for (const block of contentBlocks) {
            if (block.type === 'text' && block.text) {
              lastMessage = block.text;
              break;
            }
          }
        }
      } catch {
        // Skip invalid JSON lines
      }

      // The top title kind and a message: nothing later in the scan can beat them.
      if (lastMessage !== undefined && titles[0] !== undefined) break;
    }
  } catch {
    // Ignore file read errors
  }

  return { lastMessage, title: titles.find((t) => t !== undefined) };
}

/**
 * Get the last assistant text message from a transcript file.
 */
export function getLastAssistantMessage(transcriptPath: string): string | undefined {
  return readTranscriptInfo(transcriptPath).lastMessage;
}
