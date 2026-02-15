import React, { useEffect, useMemo, useState } from "react";
import {
  AlignBottom,
  AlignCenterVertical,
  AlignTop,
  CheckCircle,
  Info,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
} from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { analyzeTextInImage } from "@/services/geminiService";
import type {
  BackgroundMode,
  CloneDirection,
  HorizontalAlign,
  OCRResult,
  Rect,
  SlideData,
  TextOverlay,
  VerticalAlign,
} from "@/types";

interface SidebarProps {
  activeSlide: SlideData | undefined;
  selection: Rect | null;
  selectedOverlayId: string | null;
  onApplyOverlay: (overlay: TextOverlay) => Promise<void> | void;
  onUpdateSelectedOverlay: (overlayId: string, updates: Partial<TextOverlay>) => void;
}

const FONT_PRESETS = [
  "Pretendard",
  "Noto Sans KR",
  "Nanum Gothic",
  "Nanum Myeongjo",
  "IBM Plex Sans KR",
  "IBM Plex Serif KR",
  "SUIT",
  "Spoqa Han Sans Neo",
  "Apple SD Gothic Neo",
  "Malgun Gothic",
  "Batang",
  "Gulim",
  "Inter",
  "Roboto",
  "Arial",
  "Times New Roman",
  "Courier New",
  "sans-serif",
  "serif",
  "monospace",
];

const GENERIC_FONTS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
]);

const FONT_ALIAS_RULES: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /pretendard/i, family: "Pretendard" },
  { pattern: /noto\s*sans\s*(kr|korean|cjk)/i, family: "Noto Sans KR" },
  { pattern: /nanum\s*gothic|나눔\s*고딕/i, family: "Nanum Gothic" },
  { pattern: /nanum\s*myeongjo|나눔\s*명조/i, family: "Nanum Myeongjo" },
  { pattern: /ibm\s*plex\s*sans\s*kr/i, family: "IBM Plex Sans KR" },
  { pattern: /ibm\s*plex\s*serif\s*kr/i, family: "IBM Plex Serif KR" },
  { pattern: /apple\s*sd\s*gothic\s*neo/i, family: "Apple SD Gothic Neo" },
  { pattern: /malgun|맑은\s*고딕/i, family: "Malgun Gothic" },
  { pattern: /batang|바탕/i, family: "Batang" },
  { pattern: /gulim|굴림/i, family: "Gulim" },
  { pattern: /times/i, family: "Times New Roman" },
  { pattern: /arial/i, family: "Arial" },
  { pattern: /roboto/i, family: "Roboto" },
  { pattern: /inter/i, family: "Inter" },
];

const normalizeHexColor = (value: string, fallback: string) => {
  const v = value.trim();
  if (/^#([0-9a-fA-F]{6})$/.test(v)) return v.toUpperCase();
  if (/^#([0-9a-fA-F]{3})$/.test(v)) {
    const c = v.slice(1);
    return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`.toUpperCase();
  }
  return fallback;
};

const normalizeFontWeight = (value: unknown, fallback = 500) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(900, Math.max(100, Math.round(parsed / 100) * 100));
};

const normalizeNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number.parseFloat(String(value ?? fallback));
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const isCompleteNumberInput = (value: string) => {
  const t = value.trim();
  return t !== "" && t !== "-" && t !== "+" && t !== "." && t !== "-." && t !== "+.";
};

const getPrimaryFontName = (value: string) => value.split(",")[0]?.replace(/["']/g, "").trim() || "";
const hasKorean = (value: string) => /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(value);

const toFontStack = (family: string, sampleText: string) => {
  const primary = getPrimaryFontName(family);
  if (!primary) return "Inter, sans-serif";
  if (GENERIC_FONTS.has(primary.toLowerCase())) return primary;

  const normalized = primary.includes(" ") ? `"${primary}"` : primary;
  if (hasKorean(sampleText) || /kr|gothic|myeongjo|batang|gulim|hangul|korean/i.test(primary)) {
    return `${normalized}, "Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif`;
  }
  return `${normalized}, Inter, "Noto Sans KR", sans-serif`;
};

const resolveBestFontFamily = (candidate: string, sampleText: string) => {
  const primary = getPrimaryFontName(candidate);
  const alias = FONT_ALIAS_RULES.find(({ pattern }) => pattern.test(primary))?.family;

  if (alias) return toFontStack(alias, sampleText);
  if (primary) return toFontStack(primary, sampleText);
  return toFontStack(hasKorean(sampleText) ? "Pretendard" : "Inter", sampleText);
};

const ensureGoogleFontLoaded = (fontFamily: string) => {
  if (typeof document === "undefined") return;

  const primary = getPrimaryFontName(fontFamily);
  if (!primary) return;
  if (GENERIC_FONTS.has(primary.toLowerCase())) return;

  if (/^pretendard$/i.test(primary)) {
    const id = "font-pretendard";
    if (document.getElementById(id)) return;

    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css";
    document.head.appendChild(link);
    return;
  }

  const id = `font-${primary.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (document.getElementById(id)) return;

  const hrefFamily = encodeURIComponent(primary).replace(/%20/g, "+");
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${hrefFamily}:wght@100;200;300;400;500;600;700;800;900&display=swap`;
  document.head.appendChild(link);
};

const Sidebar: React.FC<SidebarProps> = ({
  activeSlide,
  selection,
  selectedOverlayId,
  onApplyOverlay,
  onUpdateSelectedOverlay,
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);

  const [replacementText, setReplacementText] = useState("");
  const [fontSize, setFontSize] = useState(16);
  const [fontSizeInput, setFontSizeInput] = useState("16");
  const [fontWeight, setFontWeight] = useState(500);
  const [fontWeightInput, setFontWeightInput] = useState("500");
  const [fontColor, setFontColor] = useState("#000000");
  const [fontFamily, setFontFamily] = useState("Inter");
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [letterSpacingInput, setLetterSpacingInput] = useState("0");
  const [lineHeight, setLineHeight] = useState(1.2);
  const [lineHeightInput, setLineHeightInput] = useState("1.2");
  const [backgroundColor, setBackgroundColor] = useState("#FFFFFF");
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>("clone");
  const [cloneDirection, setCloneDirection] = useState<CloneDirection>("up");

  const [vAlign, setVAlign] = useState<VerticalAlign>("top");
  const [hAlign, setHAlign] = useState<HorizontalAlign>("left");

  const selectedOverlay = activeSlide?.overlays.find((o) => o.id === selectedOverlayId);
  const isEditing = !!selectedOverlayId;

  useEffect(() => {
    if (!selection && !selectedOverlayId) {
      setOcrResult(null);
      setReplacementText("");
    }
  }, [selection, selectedOverlayId]);

  useEffect(() => {
    if (!selectedOverlay) return;

    setReplacementText(selectedOverlay.newText);
    const nextFontSize = normalizeNumber(selectedOverlay.fontSize, 6, 400, 16);
    setFontSize(nextFontSize);
    setFontSizeInput(String(nextFontSize));

    const nextFontWeight = normalizeFontWeight(selectedOverlay.fontWeight, 500);
    setFontWeight(nextFontWeight);
    setFontWeightInput(String(nextFontWeight));

    setFontColor(normalizeHexColor(selectedOverlay.fontColor, "#000000"));
    setFontFamily(selectedOverlay.fontFamily || "Inter");

    const nextLetterSpacing = normalizeNumber(selectedOverlay.letterSpacing, -2, 12, 0);
    setLetterSpacing(nextLetterSpacing);
    setLetterSpacingInput(String(nextLetterSpacing));

    const nextLineHeight = normalizeNumber(selectedOverlay.lineHeight, 0.8, 2.4, 1.2);
    setLineHeight(nextLineHeight);
    setLineHeightInput(String(nextLineHeight));

    setBackgroundColor(normalizeHexColor(selectedOverlay.backgroundColor, "#FFFFFF"));
    setBackgroundMode(selectedOverlay.backgroundMode || "clone");
    setCloneDirection(selectedOverlay.cloneDirection || "up");
    setVAlign(selectedOverlay.vAlign || "top");
    setHAlign(selectedOverlay.hAlign || "left");

    ensureGoogleFontLoaded(selectedOverlay.fontFamily || "Inter");
  }, [selectedOverlay]);

  const fontFamilyOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...FONT_PRESETS,
            getPrimaryFontName(fontFamily),
            getPrimaryFontName(selectedOverlay?.fontFamily || ""),
            getPrimaryFontName(ocrResult?.fontFamily || ""),
          ].filter(Boolean)
        )
      ),
    [fontFamily, ocrResult?.fontFamily, selectedOverlay?.fontFamily]
  );

  const updateSelectedOverlay = (updates: Partial<TextOverlay>) => {
    if (!selectedOverlayId) return;
    onUpdateSelectedOverlay(selectedOverlayId, updates);
  };

  const commitFontSizeInput = () => {
    const next = normalizeNumber(fontSizeInput, 6, 400, fontSize);
    setFontSize(next);
    setFontSizeInput(String(next));
  };

  const commitFontWeightInput = () => {
    const next = normalizeFontWeight(fontWeightInput, fontWeight);
    setFontWeight(next);
    setFontWeightInput(String(next));
  };

  const commitLetterSpacingInput = () => {
    const next = normalizeNumber(letterSpacingInput, -2, 12, letterSpacing);
    setLetterSpacing(next);
    setLetterSpacingInput(String(next));
  };

  const commitLineHeightInput = () => {
    const next = normalizeNumber(lineHeightInput, 0.8, 2.4, lineHeight);
    setLineHeight(next);
    setLineHeightInput(String(next));
  };

  const runAnalyze = async () => {
    if (!selection || !activeSlide) return;

    setIsAnalyzing(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = selection.width;
      canvas.height = selection.height;
      const ctx = canvas.getContext("2d");

      const img = new Image();
      img.src = activeSlide.dataUrl;
      await new Promise((resolve) => {
        img.onload = resolve;
      });

      ctx?.drawImage(
        img,
        selection.x,
        selection.y,
        selection.width,
        selection.height,
        0,
        0,
        selection.width,
        selection.height
      );

      const cropDataUrl = canvas.toDataURL("image/png");
      const result = await analyzeTextInImage(cropDataUrl);
      const resolvedFont = resolveBestFontFamily(result.fontFamily || "Inter", result.text || "");

      setOcrResult(result);
      setReplacementText(result.text || "");
      const nextFontSize = normalizeNumber(result.fontSize, 6, 400, 16);
      setFontSize(nextFontSize);
      setFontSizeInput(String(nextFontSize));

      const nextFontWeight = normalizeFontWeight(result.fontWeight, 500);
      setFontWeight(nextFontWeight);
      setFontWeightInput(String(nextFontWeight));

      setFontColor(normalizeHexColor(result.fontColor, "#000000"));
      setFontFamily(resolvedFont);

      const nextLetterSpacing = normalizeNumber(result.letterSpacing, -2, 12, 0);
      setLetterSpacing(nextLetterSpacing);
      setLetterSpacingInput(String(nextLetterSpacing));

      const nextLineHeight = normalizeNumber(result.lineHeight, 0.8, 2.4, 1.2);
      setLineHeight(nextLineHeight);
      setLineHeightInput(String(nextLineHeight));

      setBackgroundColor(normalizeHexColor(result.backgroundColor, "#FFFFFF"));
      setVAlign("middle");
      setHAlign("center");

      ensureGoogleFontLoaded(resolvedFont);
    } catch (err) {
      console.error(err);
      alert("OCR 분석 중 오류가 발생했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApply = async () => {
    if (!selection || !ocrResult) return;

    const resolvedFont = resolveBestFontFamily(fontFamily, replacementText);
    setIsApplying(true);
    try {
      await onApplyOverlay({
        id: Math.random().toString(36).slice(2, 11),
        rect: { ...selection },
        originalText: ocrResult.text,
        newText: replacementText,
        fontSize,
        fontWeight,
        fontColor,
        fontFamily: resolvedFont,
        letterSpacing,
        lineHeight,
        backgroundColor,
        backgroundMode,
        cloneDirection,
        vAlign,
        hAlign,
      });
    } finally {
      setIsApplying(false);
    }
  };

  const handleApplyEdit = () => {
    if (!isEditing || !selectedOverlayId || !activeSlide) {
      alert("수정할 텍스트를 먼저 선택하세요.");
      return;
    }

    const resolvedFont = resolveBestFontFamily(fontFamily, replacementText);
    updateSelectedOverlay({
      newText: replacementText,
      fontSize,
      fontWeight,
      fontColor,
      fontFamily: resolvedFont,
      letterSpacing,
      lineHeight,
      backgroundColor,
      backgroundMode,
      cloneDirection,
      vAlign,
      hAlign,
    });
  };

  return (
    <Card className="min-h-0">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">텍스트 교체 패널</CardTitle>
          <Badge variant={isEditing ? "default" : "outline"}>{isEditing ? "Edit" : "Insert"}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 overflow-y-auto pb-4">
        {!selection && !isEditing ? (
          <div className="flex h-[220px] flex-col items-center justify-center rounded-xl border bg-muted/20 text-center">
            <Info size={28} className="mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              캔버스에서 영역을 선택하거나
              <br />
              이미 적용한 텍스트를 클릭하세요.
            </p>
          </div>
        ) : (
          <>
            {!isEditing && (
              <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <Label>AI OCR / 스타일 복사</Label>
                  {ocrResult && <Badge variant="secondary">완료</Badge>}
                </div>
                {ocrResult && (
                  <p className="rounded-md bg-background p-2 text-xs text-muted-foreground">
                    인식: "{ocrResult.text}"
                  </p>
                )}
                <Button variant="outline" onClick={runAnalyze} disabled={isAnalyzing} className="w-full">
                  {isAnalyzing ? "분석 중..." : "텍스트+스타일"}
                </Button>
              </div>
            )}

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="replacement">내용</Label>
              <Textarea
                id="replacement"
                value={replacementText}
                onChange={(e) => setReplacementText(e.target.value)}
                className="min-h-24"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>수평 정렬</Label>
                <div className="grid grid-cols-3 gap-1">
                  <Button variant={hAlign === "left" ? "default" : "outline"} size="icon-sm" onClick={() => setHAlign("left")}>
                    <TextAlignLeft size={15} />
                  </Button>
                  <Button variant={hAlign === "center" ? "default" : "outline"} size="icon-sm" onClick={() => setHAlign("center")}>
                    <TextAlignCenter size={15} />
                  </Button>
                  <Button variant={hAlign === "right" ? "default" : "outline"} size="icon-sm" onClick={() => setHAlign("right")}>
                    <TextAlignRight size={15} />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>수직 정렬</Label>
                <div className="grid grid-cols-3 gap-1">
                  <Button variant={vAlign === "top" ? "default" : "outline"} size="icon-sm" onClick={() => setVAlign("top")}>
                    <AlignTop size={15} />
                  </Button>
                  <Button variant={vAlign === "middle" ? "default" : "outline"} size="icon-sm" onClick={() => setVAlign("middle")}>
                    <AlignCenterVertical size={15} />
                  </Button>
                  <Button variant={vAlign === "bottom" ? "default" : "outline"} size="icon-sm" onClick={() => setVAlign("bottom")}>
                    <AlignBottom size={15} />
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fontFamily">글꼴</Label>
              <Input
                id="fontFamily"
                list="font-family-options"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                onBlur={() => {
                  const resolved = resolveBestFontFamily(fontFamily, replacementText);
                  setFontFamily(resolved);
                  ensureGoogleFontLoaded(resolved);
                }}
                placeholder="폰트명 입력 (예: Pretendard, Noto Sans KR)"
              />
              <datalist id="font-family-options">
                {fontFamilyOptions.map((font) => (
                  <option key={font} value={font} />
                ))}
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="fontSize">크기(px)</Label>
                <Input
                  id="fontSize"
                  type="number"
                  min={6}
                  max={400}
                  value={fontSizeInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setFontSizeInput(raw);
                    if (!isCompleteNumberInput(raw)) return;
                    const parsed = Number.parseFloat(raw);
                    if (!Number.isNaN(parsed) && parsed >= 6 && parsed <= 400) {
                      setFontSize(parsed);
                    }
                  }}
                  onBlur={commitFontSizeInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitFontSizeInput();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fontWeight">두께(100~900)</Label>
                <Input
                  id="fontWeight"
                  type="number"
                  min={100}
                  max={900}
                  step={100}
                  value={fontWeightInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setFontWeightInput(raw);
                    if (!isCompleteNumberInput(raw)) return;
                    const parsed = Number.parseInt(raw, 10);
                    if (!Number.isNaN(parsed) && parsed >= 100 && parsed <= 900) {
                      setFontWeight(parsed);
                    }
                  }}
                  onBlur={commitFontWeightInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitFontWeightInput();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="letterSpacing">자간(px)</Label>
                <Input
                  id="letterSpacing"
                  type="number"
                  min={-2}
                  max={12}
                  step={0.1}
                  value={letterSpacingInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setLetterSpacingInput(raw);
                    if (!isCompleteNumberInput(raw)) return;
                    const parsed = Number.parseFloat(raw);
                    if (!Number.isNaN(parsed) && parsed >= -2 && parsed <= 12) {
                      setLetterSpacing(parsed);
                    }
                  }}
                  onBlur={commitLetterSpacingInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitLetterSpacingInput();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lineHeight">행간 배수</Label>
                <Input
                  id="lineHeight"
                  type="number"
                  min={0.8}
                  max={2.4}
                  step={0.05}
                  value={lineHeightInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setLineHeightInput(raw);
                    if (!isCompleteNumberInput(raw)) return;
                    const parsed = Number.parseFloat(raw);
                    if (!Number.isNaN(parsed) && parsed >= 0.8 && parsed <= 2.4) {
                      setLineHeight(parsed);
                    }
                  }}
                  onBlur={commitLineHeightInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitLineHeightInput();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>배경 복원 모드</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button variant={backgroundMode === "solid" ? "default" : "outline"} onClick={() => setBackgroundMode("solid")}>단색</Button>
                <Button variant={backgroundMode === "clone" ? "default" : "outline"} onClick={() => setBackgroundMode("clone")}>클론복제</Button>
              </div>
              {backgroundMode === "clone" && (
                <div className="space-y-2">
                  <Label>클론 방향</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant={cloneDirection === "up" ? "default" : "outline"} onClick={() => setCloneDirection("up")}>위쪽</Button>
                    <Button variant={cloneDirection === "down" ? "default" : "outline"} onClick={() => setCloneDirection("down")}>아래쪽</Button>
                    <Button variant={cloneDirection === "left" ? "default" : "outline"} onClick={() => setCloneDirection("left")}>왼쪽</Button>
                    <Button variant={cloneDirection === "right" ? "default" : "outline"} onClick={() => setCloneDirection("right")}>오른쪽</Button>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="fontColor">글자색</Label>
                <div className="border-input dark:bg-input/30 flex h-8 items-center gap-2 rounded-lg border px-2">
                  <input id="fontColor" type="color" value={fontColor} onChange={(e) => setFontColor(normalizeHexColor(e.target.value, "#000000"))} className="h-5 w-6 cursor-pointer bg-transparent" />
                  <span className="text-xs text-muted-foreground">{fontColor.toUpperCase()}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="backgroundColor">배경색(단색 모드)</Label>
                <div className="border-input dark:bg-input/30 flex h-8 items-center gap-2 rounded-lg border px-2">
                  <input
                    id="backgroundColor"
                    type="color"
                    value={backgroundColor}
                    disabled={backgroundMode !== "solid"}
                    onChange={(e) => setBackgroundColor(normalizeHexColor(e.target.value, "#FFFFFF"))}
                    className="h-5 w-6 cursor-pointer bg-transparent disabled:opacity-40"
                  />
                  <span className="text-xs text-muted-foreground">{backgroundColor.toUpperCase()}</span>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-card/95 pt-2 backdrop-blur">
              {isEditing && (
                <Button className="w-full" onClick={handleApplyEdit}>
                  <CheckCircle size={16} /> 변경 적용
                </Button>
              )}

              {!isEditing && (
                <Button className="w-full" onClick={handleApply} disabled={!ocrResult || isApplying}>
                  <CheckCircle size={16} /> {isApplying ? "적용 중..." : "텍스트 적용"}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default Sidebar;
