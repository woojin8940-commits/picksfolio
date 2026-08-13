import React from 'react';

// Lightweight markdown renderer for the AI assistant's replies.
//
// The collaboration AI (Gemini) answers in markdown — it leans on **bold**,
// bullet/numbered lists and short headings to keep answers scannable. Rendering
// that as raw text shows the literal `**`, `-` and `1.` markers, which reads
// poorly. This component turns the common subset of markdown the model actually
// produces into clean, readable elements.
//
// Short-form scene guides are the one shape that needs real nesting: each cut is
// a numbered scene with `영상`/`자막` lines under it. So list items keep their own
// children and ordered items render the number written in the source — otherwise
// a sub-bullet would split the list and every scene would restart at "1.".
//
// It builds real React nodes (never dangerouslySetInnerHTML), so there is no
// HTML-injection surface — any stray markup in the model output is shown as
// plain text.

// --- Inline formatting: **bold**, *italic* / _italic_, `code`, ~~strike~~ ---
const INLINE_RE = /(\*\*([^*]+?)\*\*|`([^`]+?)`|~~([^~]+?)~~|(?:\*|_)([^*_]+?)(?:\*|_))/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-i${i++}`;
    if (match[2] !== undefined) {
      nodes.push(<strong key={key} className="font-semibold text-gray-900">{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      nodes.push(
        <code key={key} className="px-1 py-0.5 rounded bg-gray-200/70 text-[0.92em] font-mono text-gray-800">
          {match[3]}
        </code>,
      );
    } else if (match[4] !== undefined) {
      nodes.push(<s key={key} className="text-gray-500">{match[4]}</s>);
    } else if (match[5] !== undefined) {
      nodes.push(<em key={key} className="italic">{match[5]}</em>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

interface ListItem {
  /** Item text; extra entries are wrapped continuation lines. */
  lines: string[];
  /** Number shown for ordered items ("3" from `3.` / `3)`). */
  number?: string;
  children: ListItem[];
}

interface Block {
  type: 'p' | 'h' | 'ul' | 'ol';
  level?: number;
  /** Paragraph / heading text. */
  lines: string[];
  /** List content. */
  items: ListItem[];
}

/**
 * Sub-lines of a scene guide. Models routinely drop the leading indentation on
 * these, which would break the scene out into its own list, so they are nested
 * by label as well as by indentation.
 */
const SCENE_SUB_LABEL_RE = /^\*{0,2}(영상|장면|자막|화면|멘트|나레이션|대사|음악|편집|비고)\*{0,2}\s*[:：]/;

// Group the raw text into block-level chunks (paragraphs, headings, lists).
function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'p', lines: para, items: [] });
      para = [];
    }
  };

  /** The list we are currently adding items to, if the last block is one. */
  const openList = (): Block | null => {
    const last = blocks[blocks.length - 1];
    return last && (last.type === 'ul' || last.type === 'ol') && last.items.length > 0 ? last : null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushPara();
      continue;
    }

    const indent = line.length - line.trimStart().length;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line.trim());
    const bullet = /^[-*•]\s+(.*)$/.exec(line.trim());
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(line.trim());

    if (heading) {
      flushPara();
      blocks.push({ type: 'h', level: heading[1].length, lines: [heading[2]], items: [] });
      continue;
    }

    if (bullet || ordered) {
      flushPara();
      const text = bullet ? bullet[1] : ordered![2];
      const list = openList();
      const nested = !!list && !ordered && (indent >= 2 || SCENE_SUB_LABEL_RE.test(text));
      if (nested) {
        list!.items[list!.items.length - 1].children.push({ lines: [text], children: [] });
        continue;
      }
      const type = ordered ? 'ol' : 'ul';
      const item: ListItem = { lines: [text], number: ordered ? ordered[1] : undefined, children: [] };
      if (list && list.type === type) list.items.push(item);
      else blocks.push({ type, lines: [], items: [item] });
      continue;
    }

    // Wrapped continuation of a list line ("• 영상: …" spilling onto the next line).
    const list = indent >= 2 ? openList() : null;
    if (list) {
      const item = list.items[list.items.length - 1];
      const target = item.children.length > 0 ? item.children[item.children.length - 1] : item;
      target.lines.push(line.trim());
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}

/** Item text plus any wrapped continuation lines. */
const ItemText: React.FC<{ item: ListItem; keyPrefix: string }> = ({ item, keyPrefix }) => (
  <>
    {item.lines.map((ln, idx) => (
      <React.Fragment key={idx}>
        {idx > 0 && <br />}
        {renderInline(ln, `${keyPrefix}-l${idx}`)}
      </React.Fragment>
    ))}
  </>
);

/** Nested lines under a scene / list item. */
const SubList: React.FC<{ items: ListItem[]; keyPrefix: string }> = ({ items, keyPrefix }) => (
  <ul className="mt-1 space-y-0.5">
    {items.map((child, idx) => (
      <li key={idx} className="flex gap-1.5">
        <span className="mt-[9px] shrink-0 w-1 h-1 rounded-full bg-gray-300" />
        <span className="min-w-0 flex-1 text-[0.95em] text-gray-700">
          <ItemText item={child} keyPrefix={`${keyPrefix}-c${idx}`} />
        </span>
      </li>
    ))}
  </ul>
);

export const AiMarkdown: React.FC<{ content: string }> = ({ content }) => {
  const blocks = parseBlocks(content || '');

  return (
    <div className="space-y-2 md:space-y-2.5">
      {blocks.map((block, bi) => {
        if (block.type === 'h') {
          const sizeCls =
            block.level === 1
              ? 'text-[15px] md:text-[17px]'
              : block.level === 2
                ? 'text-[14px] md:text-[16px]'
                : 'text-[13.5px] md:text-[15px]';
          return (
            <p key={bi} className={`font-bold text-gray-900 ${sizeCls} mt-1 first:mt-0`}>
              {renderInline(block.lines[0], `b${bi}`)}
            </p>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={bi} className="space-y-1 pl-1">
              {block.items.map((li, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="mt-[7px] shrink-0 w-1.5 h-1.5 rounded-full bg-violet-400" />
                  <span className="min-w-0 flex-1">
                    <ItemText item={li} keyPrefix={`b${bi}-${idx}`} />
                    {li.children.length > 0 && <SubList items={li.children} keyPrefix={`b${bi}-${idx}`} />}
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={bi} className="space-y-1.5 pl-1">
              {block.items.map((li, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="mt-px shrink-0 min-w-[1.1rem] text-violet-600 font-semibold tabular-nums">
                    {li.number ?? idx + 1}.
                  </span>
                  <span className="min-w-0 flex-1">
                    <ItemText item={li} keyPrefix={`b${bi}-${idx}`} />
                    {li.children.length > 0 && <SubList items={li.children} keyPrefix={`b${bi}-${idx}`} />}
                  </span>
                </li>
              ))}
            </ol>
          );
        }

        // paragraph — keep intra-paragraph line breaks
        return (
          <p key={bi} className="leading-[1.65]">
            {block.lines.map((ln, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <br />}
                {renderInline(ln, `b${bi}-${idx}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
};

export default AiMarkdown;
