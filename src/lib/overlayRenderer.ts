import type { CloneDirection, HorizontalAlign, Rect, TextOverlay, VerticalAlign } from "@/types";

interface IntRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toIntRect = (rect: Rect, canvasWidth: number, canvasHeight: number): IntRect => {
  const x = clamp(Math.floor(rect.x), 0, Math.max(0, canvasWidth - 1));
  const y = clamp(Math.floor(rect.y), 0, Math.max(0, canvasHeight - 1));
  const right = clamp(Math.ceil(rect.x + rect.width), 0, canvasWidth);
  const bottom = clamp(Math.ceil(rect.y + rect.height), 0, canvasHeight);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
};

const normalizeHexColor = (value: string, fallback: string) => {
  const v = value.trim();
  if (/^#([0-9a-fA-F]{6})$/.test(v)) return v;
  if (/^#([0-9a-fA-F]{3})$/.test(v)) {
    const c = v.slice(1);
    return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`;
  }
  return fallback;
};

const normalizeWeight = (value: number | string | undefined) => {
  const parsed = Number.parseInt(String(value ?? "500"), 10);
  if (Number.isNaN(parsed)) return 500;
  return clamp(Math.round(parsed / 100) * 100, 100, 900);
};

const normalizeLineHeight = (value: number | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) return 1.2;
  return clamp(value, 0.8, 2.4);
};

const normalizeLetterSpacing = (value: number | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return clamp(value, -2, 12);
};

const measureLineWidth = (ctx: CanvasRenderingContext2D, text: string, letterSpacing: number) => {
  if (!text) return 0;
  if (letterSpacing === 0) return ctx.measureText(text).width;

  let width = 0;
  for (let i = 0; i < text.length; i += 1) {
    width += ctx.measureText(text[i]).width;
    if (i < text.length - 1) width += letterSpacing;
  }
  return width;
};

const wrapLineByChars = (
  ctx: CanvasRenderingContext2D,
  line: string,
  maxWidth: number,
  letterSpacing: number
) => {
  if (!line) return [""];
  if (maxWidth <= 1) return [line];

  const wrapped: string[] = [];
  let current = "";

  for (const ch of line) {
    const candidate = `${current}${ch}`;
    const candidateWidth = measureLineWidth(ctx, candidate, letterSpacing);

    if (current && candidateWidth > maxWidth) {
      wrapped.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }

  if (current) wrapped.push(current);
  if (wrapped.length === 0) wrapped.push(line);
  return wrapped;
};

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  letterSpacing: number
) => {
  const paragraphLines = text.split("\n");
  const lines: string[] = [];

  paragraphLines.forEach((line, index) => {
    lines.push(...wrapLineByChars(ctx, line, maxWidth, letterSpacing));
    if (index < paragraphLines.length - 1 && line === "") {
      lines.push("");
    }
  });

  return lines.length > 0 ? lines : [""];
};

const drawLineWithSpacing = (
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  letterSpacing: number
) => {
  if (!line) return;
  if (letterSpacing === 0) {
    ctx.fillText(line, x, y);
    return;
  }

  let cursorX = x;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    ctx.fillText(ch, cursorX, y);
    cursorX += ctx.measureText(ch).width;
    if (i < line.length - 1) cursorX += letterSpacing;
  }
};

const getCloneOrder = (direction: CloneDirection | undefined) => {
  const fallback: CloneDirection[] = ["up", "down", "left", "right"];
  if (!direction) return fallback;
  return [direction];
};

const getSourceRect = (
  rect: IntRect,
  canvasWidth: number,
  canvasHeight: number,
  direction: CloneDirection
): IntRect | null => {
  const gap = 2;
  if (direction === "up") {
    const y = rect.y - rect.height - gap;
    if (y >= 0) return { x: rect.x, y, width: rect.width, height: rect.height };
  }
  if (direction === "down") {
    const y = rect.y + rect.height + gap;
    if (y + rect.height <= canvasHeight) return { x: rect.x, y, width: rect.width, height: rect.height };
  }
  if (direction === "left") {
    const x = rect.x - rect.width - gap;
    if (x >= 0) return { x, y: rect.y, width: rect.width, height: rect.height };
  }
  if (direction === "right") {
    const x = rect.x + rect.width + gap;
    if (x + rect.width <= canvasWidth) return { x, y: rect.y, width: rect.width, height: rect.height };
  }
  return null;
};

const getAverageNeighborColor = (ctx: CanvasRenderingContext2D, rect: IntRect, fallback: string) => {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  const collect = (x: number, y: number, w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    const data = ctx.getImageData(x, y, w, h).data;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count += 1;
    }
  };

  const cW = ctx.canvas.width;
  const cH = ctx.canvas.height;

  if (rect.x > 0) collect(rect.x - 1, rect.y, 1, rect.height);
  if (rect.x + rect.width < cW) collect(rect.x + rect.width, rect.y, 1, rect.height);
  if (rect.y > 0) collect(rect.x, rect.y - 1, rect.width, 1);
  if (rect.y + rect.height < cH) collect(rect.x, rect.y + rect.height, rect.width, 1);

  if (count === 0) return fallback;

  const toHex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${toHex(r / count)}${toHex(g / count)}${toHex(b / count)}`;
};

const applyBackground = (ctx: CanvasRenderingContext2D, overlay: TextOverlay, rect: IntRect) => {
  const mode = overlay.backgroundMode || "solid";
  const fallbackColor = normalizeHexColor(overlay.backgroundColor || "#ffffff", "#ffffff");

  if (mode === "solid") {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    return;
  }

  const directions = getCloneOrder(overlay.cloneDirection);

  for (const direction of directions) {
    const source = getSourceRect(rect, ctx.canvas.width, ctx.canvas.height, direction);
    if (!source) continue;

    const sourceData = ctx.getImageData(source.x, source.y, rect.width, rect.height);
    const targetData = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
    const out = new Uint8ClampedArray(targetData.data);

    const feather = 3;

    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        const idx = (y * rect.width + x) * 4;
        const distEdge = Math.min(x, y, rect.width - 1 - x, rect.height - 1 - y);
        const t = clamp(distEdge / feather, 0, 1);
        const alpha = 0.96 + 0.04 * t;

        out[idx] = Math.round(sourceData.data[idx] * alpha + targetData.data[idx] * (1 - alpha));
        out[idx + 1] = Math.round(sourceData.data[idx + 1] * alpha + targetData.data[idx + 1] * (1 - alpha));
        out[idx + 2] = Math.round(sourceData.data[idx + 2] * alpha + targetData.data[idx + 2] * (1 - alpha));
        out[idx + 3] = 255;
      }
    }

    ctx.putImageData(new ImageData(out, rect.width, rect.height), rect.x, rect.y);
    return;
  }

  const sampled = getAverageNeighborColor(ctx, rect, fallbackColor);
  ctx.fillStyle = sampled;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
};

const drawText = (ctx: CanvasRenderingContext2D, overlay: TextOverlay, rect: IntRect) => {
  const fontFamily = overlay.fontFamily || "sans-serif";
  const fontWeight = normalizeWeight(overlay.fontWeight);
  const baseFontSize = clamp(overlay.fontSize || 16, 6, 400);
  const letterSpacing = normalizeLetterSpacing(overlay.letterSpacing);
  const lineHeight = normalizeLineHeight(overlay.lineHeight);
  const hAlign: HorizontalAlign = overlay.hAlign || "left";
  const vAlign: VerticalAlign = overlay.vAlign || "top";

  let fontSize = baseFontSize;
  const minFontSize = 6;

  let lines: string[] = [];
  let lineHeightPx = 0;

  while (fontSize >= minFontSize) {
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}, sans-serif`;
    lines = wrapText(ctx, overlay.newText || "", rect.width, letterSpacing);
    lineHeightPx = fontSize * lineHeight;

    const totalHeight = lines.length * lineHeightPx;
    const maxWidth = lines.reduce((max, line) => Math.max(max, measureLineWidth(ctx, line, letterSpacing)), 0);

    if (totalHeight <= rect.height && maxWidth <= rect.width) break;
    fontSize -= 0.5;
  }

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}, sans-serif`;
  ctx.fillStyle = normalizeHexColor(overlay.fontColor || "#000000", "#000000");
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  lineHeightPx = fontSize * lineHeight;
  const totalTextHeight = lines.length * lineHeightPx;

  let startY = rect.y;
  if (vAlign === "middle") startY = rect.y + (rect.height - totalTextHeight) / 2;
  else if (vAlign === "bottom") startY = rect.y + rect.height - totalTextHeight;
  // Never render outside the target rect even when style constraints are extreme.
  startY = Math.max(rect.y, startY);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  lines.forEach((line, index) => {
    const lineWidth = measureLineWidth(ctx, line, letterSpacing);
    let startX = rect.x;

    if (hAlign === "center") startX = rect.x + (rect.width - lineWidth) / 2;
    else if (hAlign === "right") startX = rect.x + rect.width - lineWidth;

    drawLineWithSpacing(ctx, line, startX, startY + index * lineHeightPx, letterSpacing);
  });
  ctx.restore();
};

export const renderTextOverlay = (ctx: CanvasRenderingContext2D, overlay: TextOverlay) => {
  const rect = toIntRect(overlay.rect, ctx.canvas.width, ctx.canvas.height);
  if (rect.width <= 0 || rect.height <= 0) return;

  applyBackground(ctx, overlay, rect);
  drawText(ctx, overlay, rect);
};
