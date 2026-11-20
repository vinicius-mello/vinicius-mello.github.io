// Errors carry a source span { start, end } (character offsets).
export class LangError extends Error {
  constructor(message, span, kind = 'error') {
    super(message);
    this.span = span ?? null;
    this.kind = kind; // 'syntax' | 'error'
  }
}

export function locate(source, offset) {
  let line = 1, col = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') { line++; col = 1; } else col++;
  }
  return { line, col };
}

export function describe(source, err) {
  const where = err.span ? locate(source, err.span.start) : null;
  return {
    message: err.message,
    kind: err.kind ?? 'error',
    start: err.span?.start ?? null,
    end: err.span?.end ?? null,
    line: where?.line ?? null,
    col: where?.col ?? null,
  };
}
