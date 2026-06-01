import React from 'react';

// Lightweight markdown renderer for the AI assistant's replies.
//
// The collaboration AI (Gemini) answers in markdown — it leans on **bold**,
// bullet/numbered lists and short headings to keep answers scannable. Rendering
// that as raw text shows the literal `**`, `-` and `1.` markers, which reads
// poorly. This component turns the common subset of markdown the model actually
// produces into clean, readable elements.
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

interface Block {
  type: 'p' | 'h' | 'ul' | 'ol';
  level?: number;
  lines: string[];
}

// Group the raw text into block-level chunks (paragraphs, headings, lists).
function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'p', lines: para });
      para = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushPara();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (heading) {
      flushPara();
      blocks.push({ type: 'h', level: heading[1].length, lines: [heading[2]] });
    } else if (bullet) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'ul') last.lines.push(bullet[1]);
      else blocks.push({ type: 'ul', lines: [bullet[1]] });
    } else if (ordered) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'ol') last.lines.push(ordered[1]);
      else blocks.push({ type: 'ol', lines: [ordered[1]] });
    } else {
      para.push(line);
    }
  }
  flushPara();
  return blocks;
}

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
              {block.lines.map((li, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="mt-[7px] shrink-0 w-1.5 h-1.5 rounded-full bg-violet-400" />
                  <span className="min-w-0 flex-1">{renderInline(li, `b${bi}-${idx}`)}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={bi} className="space-y-1 pl-1">
              {block.lines.map((li, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="mt-px shrink-0 min-w-[1.1rem] text-violet-600 font-semibold tabular-nums">
                    {idx + 1}.
                  </span>
                  <span className="min-w-0 flex-1">{renderInline(li, `b${bi}-${idx}`)}</span>
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
