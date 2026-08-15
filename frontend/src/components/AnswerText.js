import { Fragment } from 'react';

/**
 * Assistant ke jawab ko render karta hai:
 *  - **bold** ko bold banata hai
 *  - [S1] jaise citations ko clickable chip banata hai
 */
export default function AnswerText({ text, citations = [], onCitationClick }) {
  if (!text) return null;

  const byLabel = new Map(citations.map((c) => [c.label, c]));

  // pehle citations pe split, phir har hisse me bold handle karte hain
  const parts = text.split(/(\[S\d+\])/g);

  return (
    <div className="answer-text">
      {parts.map((part, i) => {
        const citeMatch = part.match(/^\[(S\d+)\]$/);
        if (citeMatch) {
          const label = citeMatch[1];
          const source = byLabel.get(label);
          return (
            <button
              key={i}
              className={`cite-chip ${source ? '' : 'cite-chip-unknown'}`}
              title={source ? `${source.fileName}${source.page ? ` · page ${source.page}` : ''}` : 'Source nahi mila'}
              onClick={() => source && onCitationClick?.(source)}
            >
              {label}
            </button>
          );
        }
        return <Fragment key={i}>{renderBold(part)}</Fragment>;
      })}
    </div>
  );
}

function renderBold(text) {
  const segments = text.split(/(\*\*[^*]+\*\*)/g);
  return segments.map((seg, i) => {
    const m = seg.match(/^\*\*([^*]+)\*\*$/);
    return m ? <strong key={i}>{m[1]}</strong> : <Fragment key={i}>{seg}</Fragment>;
  });
}
