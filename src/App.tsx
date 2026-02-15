import React, { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  DownloadSimple,
  Eye,
  EyeSlash,
  FilePdf,
  GearSix,
  ImageSquare,
  Key,
  LockKey,
  Moon,
  SignOut,
  Sun,
  Trash,
  UploadSimple,
  UserCircle,
} from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import EditorCanvas from "@/components/EditorCanvas";
import Sidebar from "@/components/Sidebar";
import { renderTextOverlay } from "@/lib/overlayRenderer";
import { convertPdfToImages, downloadAsPdf, downloadAsPptx } from "@/services/pdfService";
import type { Rect, SlideData, TextOverlay } from "@/types";

const AUTH_USERNAME = String(import.meta.env.VITE_AUTH_USERNAME || "").trim();
const AUTH_PASSWORD = String(import.meta.env.VITE_AUTH_PASSWORD || "").trim();
const SETTINGS_PASSWORD = String(import.meta.env.VITE_SETTINGS_PASSWORD || "").trim();

const STORAGE_KEYS = {
  auth: "slidechange.authenticated",
  darkMode: "slidechange.dark_mode",
  geminiApiKey: "slidechange.gemini_api_key",
};

const maskApiKey = (key: string) => {
  if (!key) return "설정되지 않음";
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 6)}${"*".repeat(Math.max(4, key.length - 10))}${key.slice(-4)}`;
};

const getStoredValue = (key: string) => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
};

const getDefaultApiKey = () => {
  const fromEnv = String(process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
  const fromStorage = getStoredValue(STORAGE_KEYS.geminiApiKey)?.trim() || "";
  return fromStorage || fromEnv;
};

const App: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => getStoredValue(STORAGE_KEYS.auth) === "true");
  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const [darkMode, setDarkMode] = useState<boolean>(() => getStoredValue(STORAGE_KEYS.darkMode) === "true");
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => getDefaultApiKey());

  const [isApiEditMode, setIsApiEditMode] = useState(false);
  const [isApiEditUnlocked, setIsApiEditUnlocked] = useState(false);
  const [apiPassword, setApiPassword] = useState("");
  const [apiEditValue, setApiEditValue] = useState("");
  const [apiEditError, setApiEditError] = useState("");
  const [showApiText, setShowApiText] = useState(false);

  const [slides, setSlides] = useState<SlideData[]>([]);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.auth, isAuthenticated ? "true" : "false");
  }, [isAuthenticated]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.darkMode, darkMode ? "true" : "false");
    }
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = geminiApiKey.trim();
    if (!next) {
      window.localStorage.removeItem(STORAGE_KEYS.geminiApiKey);
      return;
    }
    window.localStorage.setItem(STORAGE_KEYS.geminiApiKey, next);
  }, [geminiApiKey]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!AUTH_USERNAME || !AUTH_PASSWORD) {
      setLoginError("로그인 환경변수(VITE_AUTH_USERNAME, VITE_AUTH_PASSWORD)가 설정되지 않았습니다.");
      return;
    }
    if (loginId === AUTH_USERNAME && loginPassword === AUTH_PASSWORD) {
      setIsAuthenticated(true);
      setLoginError("");
      setLoginPassword("");
      return;
    }
    setLoginError("아이디 또는 비밀번호가 올바르지 않습니다.");
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setShowAccountModal(false);
  };

  const openApiEdit = () => {
    setIsApiEditMode(true);
    setIsApiEditUnlocked(false);
    setApiPassword("");
    setApiEditValue(geminiApiKey);
    setApiEditError("");
    setShowApiText(false);
  };

  const closeApiEdit = () => {
    setIsApiEditMode(false);
    setIsApiEditUnlocked(false);
    setApiPassword("");
    setApiEditValue("");
    setApiEditError("");
    setShowApiText(false);
  };

  const verifyApiEditPassword = () => {
    if (!SETTINGS_PASSWORD) {
      setApiEditError("설정 비밀번호 환경변수(VITE_SETTINGS_PASSWORD)가 설정되지 않았습니다.");
      return;
    }
    if (apiPassword !== SETTINGS_PASSWORD) {
      setApiEditError("비밀번호가 올바르지 않습니다.");
      return;
    }
    setIsApiEditUnlocked(true);
    setApiEditError("");
  };

  const saveApiKey = () => {
    if (!isApiEditUnlocked) return;
    setGeminiApiKey(apiEditValue.trim());
    closeApiEdit();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      if (file.type === "application/pdf") {
        const converted = await convertPdfToImages(file);
        setSlides(converted);
      } else if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => {
            setSlides([
              {
                index: 0,
                dataUrl: ev.target?.result as string,
                width: img.width,
                height: img.height,
                overlays: [],
              },
            ]);
          };
          img.src = ev.target?.result as string;
        };
        reader.readAsDataURL(file);
      }
      setActiveSlideIdx(0);
      setSelectedOverlayId(null);
      setSelection(null);
    } catch (err) {
      console.error(err);
      alert("파일 변환 중 오류가 발생했습니다.");
    } finally {
      setIsProcessing(false);
      e.target.value = "";
    }
  };

  const handleApplyOverlay = async (overlay: TextOverlay) => {
    setSlides((prev) =>
      prev.map((s, idx) =>
        idx === activeSlideIdx
          ? { ...s, overlays: [...s.overlays, overlay] }
          : s
      )
    );
    setSelection(null);
    setSelectedOverlayId(overlay.id);
  };

  const handleUpdateOverlays = (overlays: TextOverlay[]) => {
    setSlides((prev) => prev.map((s, idx) => (idx === activeSlideIdx ? { ...s, overlays } : s)));
  };

  const handleUpdateSelectedOverlay = (overlayId: string, updates: Partial<TextOverlay>) => {
    setSlides((prev) =>
      prev.map((s, idx) => {
        if (idx !== activeSlideIdx) return s;
        const nextOverlays = s.overlays.map((ov) => (ov.id === overlayId ? { ...ov, ...updates } : ov));
        return { ...s, overlays: nextOverlays };
      })
    );
  };

  const handleUndo = () => {
    setSlides((prev) =>
      prev.map((s, idx) => {
        if (idx === activeSlideIdx && s.overlays.length > 0) {
          const next = [...s.overlays];
          next.pop();
          return { ...s, overlays: next };
        }
        return s;
      })
    );
    setSelectedOverlayId(null);
  };

  const clearCurrentSlide = () => {
    setSlides((prev) =>
      prev.map((s, idx) => {
        if (idx !== activeSlideIdx) return s;
        return { ...s, overlays: [] };
      })
    );
    setSelectedOverlayId(null);
  };

  const handleDownloadImages = () => {
    slides.forEach((slide, i) => {
      const canvas = document.createElement("canvas");
      canvas.width = slide.width;
      canvas.height = slide.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const img = new Image();
      img.src = slide.dataUrl;
      img.onload = () => {
        ctx.drawImage(img, 0, 0);

        slide.overlays.forEach((ov) => {
          renderTextOverlay(ctx, ov);
        });

        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/png");
        link.download = `edited_slide_${i + 1}.png`;
        link.click();
      };
    });
  };

  const handleDownloadPdf = () => {
    if (slides.length === 0) return;
    downloadAsPdf(slides, "edited_slides.pdf");
  };

  const handleDownloadPptx = async () => {
    if (slides.length === 0) return;
    setIsProcessing(true);
    try {
      await downloadAsPptx(slides, "edited_slides.pptx");
    } catch (error) {
      console.error(error);
      alert("PPTX 저장 중 오류가 발생했습니다.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LockKey size={20} /> 관리자 로그인
            </CardTitle>
            <CardDescription>로그인 후 이용할 수 있습니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleLogin}>
              <div className="space-y-2">
                <Label htmlFor="login-id">아이디</Label>
                <Input
                  id="login-id"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">비밀번호</Label>
                <Input
                  id="login-password"
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
              </div>
              {loginError && <p className="text-sm text-destructive">{loginError}</p>}
              <Button type="submit" className="w-full">
                로그인
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeSlide = slides[activeSlideIdx];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="mx-auto flex h-screen max-w-[1800px] flex-col p-4">
        <Card className="mb-4 shrink-0">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg border bg-primary/10 p-2 text-primary">
                  <img src="/slidechange-icon.svg" alt="Slide Change Studio" className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>Slide Change Studio</CardTitle>
                  <CardDescription>shadcn nova 테마 기반 슬라이드 텍스트 교체</CardDescription>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => fileInputRef.current?.click()}>
                  <UploadSimple size={16} /> 파일 업로드
                </Button>
                <Button variant="outline" disabled={slides.length === 0} onClick={handleDownloadImages}>
                  <DownloadSimple size={16} /> PNG 저장
                </Button>
                <Button variant="secondary" disabled={slides.length === 0} onClick={handleDownloadPdf}>
                  <FilePdf size={16} /> PDF 저장
                </Button>
                <Button variant="secondary" disabled={slides.length === 0 || isProcessing} onClick={handleDownloadPptx}>
                  <DownloadSimple size={16} /> PPTX 저장
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>

        <div className="grid min-h-0 flex-1 grid-cols-[64px_minmax(0,1fr)_360px] gap-4">
          <Card className="h-full">
            <CardContent className="flex h-full flex-col items-center justify-between pt-4 pb-3">
              <div className="flex flex-col items-center gap-2">
                <Button variant="outline" size="icon" onClick={handleUndo} title="실행 취소">
                  <ArrowCounterClockwise size={18} />
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={clearCurrentSlide}
                  title="현재 슬라이드 전체 삭제"
                >
                  <Trash size={18} />
                </Button>
                <Separator className="my-2" />
                <Badge variant="outline">{slides.length}</Badge>
              </div>

              <div className="flex flex-col items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  title="로그인 정보"
                  onClick={() => setShowAccountModal(true)}
                >
                  <UserCircle size={18} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="설정"
                  onClick={() => setShowSettingsModal(true)}
                >
                  <GearSix size={18} />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="min-h-0 overflow-hidden">
            <CardContent className="flex h-full flex-col p-0">
              {isProcessing ? (
                <div className="flex flex-1 items-center justify-center">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    처리 중...
                  </div>
                </div>
              ) : slides.length > 0 && activeSlide ? (
                <>
                  <EditorCanvas
                    slide={activeSlide}
                    selectedOverlayId={selectedOverlayId}
                    onSelectionChange={(rect) => {
                      setSelection(rect);
                      if (rect) setSelectedOverlayId(null);
                    }}
                    onOverlaySelect={setSelectedOverlayId}
                    onUpdateOverlays={handleUpdateOverlays}
                  />
                  <div className="flex items-center justify-center gap-3 border-t px-3 py-2">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      disabled={activeSlideIdx === 0}
                      onClick={() => setActiveSlideIdx((p) => p - 1)}
                    >
                      <ArrowLeft size={16} />
                    </Button>
                    <Badge variant="secondary">
                      {activeSlideIdx + 1} / {slides.length}
                    </Badge>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      disabled={activeSlideIdx === slides.length - 1}
                      onClick={() => setActiveSlideIdx((p) => p + 1)}
                    >
                      <ArrowRight size={16} />
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
                  <div className="rounded-2xl border bg-muted/40 p-6 text-muted-foreground">
                    <ImageSquare size={56} />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-xl font-semibold">PDF 또는 이미지를 올려 시작하세요</h2>
                    <p className="text-sm text-muted-foreground">
                      영역 선택 후 AI OCR로 텍스트 스타일을 복원하고 교체할 수 있습니다.
                    </p>
                  </div>
                  <Button onClick={() => fileInputRef.current?.click()}>
                    <UploadSimple size={16} /> 파일 선택
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Sidebar
            activeSlide={activeSlide}
            selection={selection}
            selectedOverlayId={selectedOverlayId}
            onApplyOverlay={handleApplyOverlay}
            onUpdateSelectedOverlay={handleUpdateSelectedOverlay}
          />
        </div>
      </div>

      {showAccountModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserCircle size={18} /> 로그인 정보
              </CardTitle>
              <CardDescription>현재 세션 계정 관리</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border bg-muted/20 p-3 text-sm">계정: {AUTH_USERNAME}</div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowAccountModal(false)}>
                  닫기
                </Button>
                <Button variant="destructive" onClick={handleLogout}>
                  <SignOut size={16} /> 로그아웃
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GearSix size={18} /> 설정
              </CardTitle>
              <CardDescription>다크 모드 및 Gemini API 설정</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <Label>다크 모드</Label>
                  <Badge variant={darkMode ? "default" : "outline"}>{darkMode ? "ON" : "OFF"}</Badge>
                </div>
                <Button variant="outline" onClick={() => setDarkMode((prev) => !prev)}>
                  {darkMode ? <Sun size={16} /> : <Moon size={16} />}
                  {darkMode ? "라이트 모드로 변경" : "다크 모드로 변경"}
                </Button>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <Key size={15} /> Gemini API 키
                  </Label>
                  <Button variant="outline" size="sm" onClick={openApiEdit}>
                    수정
                  </Button>
                </div>
                <div className="rounded-md border bg-muted/20 p-2 font-mono text-xs break-all">
                  {maskApiKey(geminiApiKey)}
                </div>

                {isApiEditMode && !isApiEditUnlocked && (
                  <div className="space-y-2 rounded-md border border-dashed p-2">
                    <Label htmlFor="api-password">수정 비밀번호</Label>
                    <Input
                      id="api-password"
                      type="password"
                      value={apiPassword}
                      onChange={(e) => setApiPassword(e.target.value)}
                      placeholder="비밀번호 입력"
                    />
                    {apiEditError && <p className="text-xs text-destructive">{apiEditError}</p>}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={verifyApiEditPassword}>인증</Button>
                      <Button size="sm" variant="outline" onClick={closeApiEdit}>취소</Button>
                    </div>
                  </div>
                )}

                {isApiEditMode && isApiEditUnlocked && (
                  <div className="space-y-2 rounded-md border border-dashed p-2">
                    <Label htmlFor="api-edit">새 API 키</Label>
                    <div className="flex gap-2">
                      <Input
                        id="api-edit"
                        type={showApiText ? "text" : "password"}
                        value={apiEditValue}
                        onChange={(e) => setApiEditValue(e.target.value)}
                        placeholder="AIza..."
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setShowApiText((prev) => !prev)}
                        title="표시 전환"
                      >
                        {showApiText ? <EyeSlash size={16} /> : <Eye size={16} />}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveApiKey}>저장</Button>
                      <Button size="sm" variant="outline" onClick={closeApiEdit}>취소</Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setShowSettingsModal(false)}>
                  닫기
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default App;
