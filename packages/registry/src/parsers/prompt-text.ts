/**
 * Turn the text of a "user" transcript message into the prompt a human typed,
 * or null when the harness wrote it. Receipts, waste, and prompt clusters
 * group spend by prompt, so injected text must not count as one.
 */

/** Harness blocks that never contain the human's words. */
const DROPPED_BLOCKS = [
  'system-reminder',
  'local-command-stdout',
  'local-command-stderr',
  'local-command-caveat',
  'command-message',
];

/** Messages that are entirely harness-generated. */
const NON_PROMPT_PREFIXES = [
  '<task-notification',
  'Caveat: The messages below were generated',
  'Base directory for this skill:',
];

function stripBlocks(text: string, tag: string): string {
  return text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g'), '');
}

function inner(text: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(text);
  return match ? match[1]!.trim() : null;
}

export function cleanPromptText(raw: string, maxChars: number): string | null {
  let text = raw.trim();
  if (NON_PROMPT_PREFIXES.some((prefix) => text.startsWith(prefix))) return null;

  for (const tag of DROPPED_BLOCKS) text = stripBlocks(text, tag);

  // Slash commands: `<command-name>/review</command-name><command-args>42</command-args>`.
  const command = inner(text, 'command-name');
  if (command !== null) {
    const args = inner(text, 'command-args');
    text = args ? `${command} ${args}` : command;
  }

  // `!` shell escapes typed in the prompt box.
  const bash = inner(text, 'bash-input');
  if (bash !== null) text = `! ${bash}`;

  // Pasted text is the user's input; keep it, minus the wrapper. Long pastes
  // are often logged without the closing tag, so drop each tag on its own.
  text = text.replace(/<\/?pasted_content\b[^>]*>/g, ' ').replace(/[ \t]{2,}/g, ' ');

  text = text.trim();
  if (text.length === 0) return null;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
