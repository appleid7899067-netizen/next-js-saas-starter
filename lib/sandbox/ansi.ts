/**
 * Minimal ANSI SGR -> HTML converter used to render terminal output in the
 * browser without pulling in a terminal emulator.
 *
 * Supports the colour/attribute subset that shells, git, npm and friends
 * actually emit (0-9, 22, 30-37, 39, 40-47, 49, 90-97, 100-107 and the
 * 38;5;n / 48;5;n 256-colour forms).
 */

const SGR_PATTERN = /\u001b\[([0-9;]*)m/g;

const BASIC_COLORS = [
  '#1f2933', // 30 black
  '#e5484d', // 31 red
  '#46a758', // 32 green
  '#f5a524', // 33 yellow
  '#3b82f6', // 34 blue
  '#a855f7', // 35 magenta
  '#06b6d4', // 36 cyan
  '#e5e7eb' // 37 white
];

const BRIGHT_COLORS = [
  '#6b7280', // 90
  '#ff6369', // 91
  '#63c174', // 92
  '#ffca16', // 93
  '#7aa2f7', // 94
  '#c084fc', // 95
  '#22d3ee', // 96
  '#f9fafb' // 97
];

const BACKGROUNDS = [
  '#1f2933',
  '#7f1d1d',
  '#14532d',
  '#713f12',
  '#1e3a8a',
  '#4c1d95',
  '#164e63',
  '#e5e7eb'
];

type Style = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
};

export function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function color256(index: number) {
  if (index < 8) return BASIC_COLORS[index];
  if (index < 16) return BRIGHT_COLORS[index - 8];
  if (index < 232) {
    const value = index - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(value / 36) % 6];
    const g = steps[Math.floor(value / 6) % 6];
    const b = steps[value % 6];
    return `rgb(${r},${g},${b})`;
  }
  const level = 8 + (index - 232) * 10;
  return `rgb(${level},${level},${level})`;
}

function applyCodes(codes: number[], style: Style) {
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];

    if (code === 0) {
      Object.keys(style).forEach((key) => delete style[key as keyof Style]);
    } else if (code === 1) {
      style.bold = true;
    } else if (code === 2) {
      style.dim = true;
    } else if (code === 3) {
      style.italic = true;
    } else if (code === 4) {
      style.underline = true;
    } else if (code === 9) {
      style.strike = true;
    } else if (code === 22) {
      style.bold = false;
      style.dim = false;
    } else if (code === 23) {
      style.italic = false;
    } else if (code === 24) {
      style.underline = false;
    } else if (code === 29) {
      style.strike = false;
    } else if (code >= 30 && code <= 37) {
      style.fg = BASIC_COLORS[code - 30];
    } else if (code === 39) {
      delete style.fg;
    } else if (code >= 40 && code <= 47) {
      style.bg = BACKGROUNDS[code - 40];
    } else if (code === 49) {
      delete style.bg;
    } else if (code >= 90 && code <= 97) {
      style.fg = BRIGHT_COLORS[code - 90];
    } else if (code >= 100 && code <= 107) {
      style.bg = BACKGROUNDS[code - 100];
    } else if ((code === 38 || code === 48) && codes[i + 1] === 5) {
      const color = color256(codes[i + 2] ?? 0);
      if (code === 38) style.fg = color;
      else style.bg = color;
      i += 2;
    } else if ((code === 38 || code === 48) && codes[i + 1] === 2) {
      const color = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`;
      if (code === 38) style.fg = color;
      else style.bg = color;
      i += 4;
    }
  }
}

function styleToCss(style: Style) {
  const declarations: string[] = [];
  if (style.fg) declarations.push(`color:${style.fg}`);
  if (style.bg) declarations.push(`background-color:${style.bg}`);
  if (style.bold) declarations.push('font-weight:600');
  if (style.dim) declarations.push('opacity:.65');
  if (style.italic) declarations.push('font-style:italic');
  if (style.underline) declarations.push('text-decoration:underline');
  if (style.strike) declarations.push('text-decoration:line-through');
  return declarations.join(';');
}

export function ansiToHtml(input: string) {
  const style: Style = {};
  let html = '';
  let lastIndex = 0;

  SGR_PATTERN.lastIndex = 0;

  for (let match = SGR_PATTERN.exec(input); match !== null; match = SGR_PATTERN.exec(input)) {
    const text = input.slice(lastIndex, match.index);
    if (text) {
      const css = styleToCss(style);
      html += css
        ? `<span style="${css}">${escapeHtml(text)}</span>`
        : escapeHtml(text);
    }

    const codes = (match[1] || '0')
      .split(';')
      .map((value) => (value === '' ? 0 : Number.parseInt(value, 10)))
      .filter((value) => Number.isFinite(value));

    applyCodes(codes.length ? codes : [0], style);
    lastIndex = match.index + match[0].length;
  }

  const rest = input.slice(lastIndex);
  if (rest) {
    const css = styleToCss(style);
    html += css ? `<span style="${css}">${escapeHtml(rest)}</span>` : escapeHtml(rest);
  }

  return html;
}

/** Strips control sequences from untrusted text (used for logs/transcripts). */
export function stripAnsi(input: string) {
  return input
    .replace(/\u001b\][^\u0007]*\u0007/g, '') // OSC … BEL
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '') // CSI
    .replace(/\u001b[()][A-Za-z0-9]/g, '') // charset
    .replace(/\r/g, '');
}
