export const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s+/;

/** Splits model text into paragraphs and lists: consecutive list lines form one list, a blank line ends a block. */
export function blocksOf(text: string) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  let open = false;
  for (const line of text.trim().split("\n")) {
    if (!line.trim()) { open = false; continue; }
    const list = LIST_ITEM.test(line);
    const last = blocks.at(-1);
    if (open && last?.list === list) last.lines.push(line);
    else blocks.push({ list, lines: [line] });
    open = true;
  }
  return blocks;
}
