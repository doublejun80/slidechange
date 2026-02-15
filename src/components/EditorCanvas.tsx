import React, { useCallback, useEffect, useRef, useState } from "react";

import { COLORS, HANDLE_SIZE, MAX_ZOOM, MIN_RECT_SIZE, MIN_ZOOM, PAN_STEP, ZOOM_STEP } from "@/constants";
import { renderTextOverlay } from "@/lib/overlayRenderer";
import type { HandleType, Point, Rect, SlideData, TextOverlay } from "@/types";

interface EditorCanvasProps {
  slide: SlideData;
  selectedOverlayId: string | null;
  onSelectionChange: (rect: Rect | null) => void;
  onOverlaySelect: (id: string | null) => void;
  onUpdateOverlays: (overlays: TextOverlay[]) => void;
}

const EditorCanvas: React.FC<EditorCanvasProps> = ({
  slide,
  selectedOverlayId,
  onSelectionChange,
  onOverlaySelect,
  onUpdateOverlays,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const composeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [selection, setSelection] = useState<Rect | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [isResizingSelection, setIsResizingSelection] = useState(false);
  const [isDraggingOverlay, setIsDraggingOverlay] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const [dragType, setDragType] = useState<"move" | HandleType | null>(null);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.code === "Space") {
        if (isInput) return;
        setIsSpacePressed(e.type === "keydown");
        if (e.type === "keydown") e.preventDefault();
        return;
      }

      if (e.type === "keydown" && !isInput) {
        if (e.code === "ArrowUp") {
          setOffset((prev) => ({ ...prev, y: prev.y + PAN_STEP }));
          e.preventDefault();
        } else if (e.code === "ArrowDown") {
          setOffset((prev) => ({ ...prev, y: prev.y - PAN_STEP }));
          e.preventDefault();
        } else if (e.code === "ArrowLeft") {
          setOffset((prev) => ({ ...prev, x: prev.x + PAN_STEP }));
          e.preventDefault();
        } else if (e.code === "ArrowRight") {
          setOffset((prev) => ({ ...prev, x: prev.x - PAN_STEP }));
          e.preventDefault();
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
    };
  }, []);

  useEffect(() => {
    const img = new Image();
    img.src = slide.dataUrl;
    img.onload = () => {
      setImage(img);
      if (!containerRef.current) return;

      const { clientWidth, clientHeight } = containerRef.current;
      const scale = Math.min((clientWidth - 80) / img.width, (clientHeight - 80) / img.height);
      setZoom(scale);
      setOffset({
        x: (clientWidth - img.width * scale) / 2,
        y: (clientHeight - img.height * scale) / 2,
      });
    };
  }, [slide.dataUrl]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        const factor = delta > 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
        setZoom((prevZoom) => {
          const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom * factor));
          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) return prevZoom;

          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;

          setOffset((prevOffset) => {
            const wx = (mouseX - prevOffset.x) / prevZoom;
            const wy = (mouseY - prevOffset.y) / prevZoom;
            return { x: mouseX - wx * nextZoom, y: mouseY - wy * nextZoom };
          });

          return nextZoom;
        });
      } else if (!isSpacePressed) {
        setOffset((prev) => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
      }
    };

    container.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => container.removeEventListener("wheel", handleWheelNative);
  }, [isSpacePressed]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !image) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Compose overlays in slide coordinate space (unscaled) to keep background sampling correct.
    if (!composeCanvasRef.current) {
      composeCanvasRef.current = document.createElement("canvas");
    }
    const composeCanvas = composeCanvasRef.current;
    if (composeCanvas.width !== image.width || composeCanvas.height !== image.height) {
      composeCanvas.width = image.width;
      composeCanvas.height = image.height;
    }
    const composeCtx = composeCanvas.getContext("2d");
    if (!composeCtx) return;

    composeCtx.clearRect(0, 0, composeCanvas.width, composeCanvas.height);
    composeCtx.drawImage(image, 0, 0);
    slide.overlays.forEach((overlay) => {
      renderTextOverlay(composeCtx, overlay);
    });

    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);
    ctx.drawImage(composeCanvas, 0, 0);

    slide.overlays.forEach((overlay) => {
      if (overlay.id === selectedOverlayId) {
        ctx.strokeStyle = COLORS.primary;
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(overlay.rect.x, overlay.rect.y, overlay.rect.width, overlay.rect.height);
      }
    });

    if (selection) {
      ctx.strokeStyle = COLORS.primary;
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(selection.x, selection.y, selection.width, selection.height);
      ctx.fillStyle = COLORS.overlay;
      ctx.fillRect(selection.x, selection.y, selection.width, selection.height);

      const handles: Point[] = [
        { x: selection.x, y: selection.y },
        { x: selection.x + selection.width / 2, y: selection.y },
        { x: selection.x + selection.width, y: selection.y },
        { x: selection.x + selection.width, y: selection.y + selection.height / 2 },
        { x: selection.x + selection.width, y: selection.y + selection.height },
        { x: selection.x + selection.width / 2, y: selection.y + selection.height },
        { x: selection.x, y: selection.y + selection.height },
        { x: selection.x, y: selection.y + selection.height / 2 },
      ];

      ctx.fillStyle = COLORS.handle;
      handles.forEach((h) => {
        ctx.fillRect(
          h.x - (HANDLE_SIZE / 2) / zoom,
          h.y - (HANDLE_SIZE / 2) / zoom,
          HANDLE_SIZE / zoom,
          HANDLE_SIZE / zoom
        );
      });
    }

    ctx.restore();
  }, [image, offset, selectedOverlayId, selection, slide.overlays, zoom]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getCanvasCoords = (e: React.MouseEvent | MouseEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - offset.x) / zoom,
      y: (e.clientY - rect.top - offset.y) / zoom,
    };
  };

  const getScreenCoords = (e: React.MouseEvent | MouseEvent): Point => ({ x: e.clientX, y: e.clientY });

  const isPointInRect = (p: Point, rect: Rect) => p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;

  const getHandleAt = (p: Point, rect: Rect): HandleType | null => {
    const tolerance = HANDLE_SIZE / zoom;
    const hx = [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
    const hy = [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
    const types: (HandleType | null)[][] = [
      ["nw", "n", "ne"],
      ["w", null, "e"],
      ["sw", "s", "se"],
    ];

    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        const type = types[i][j];
        if (type && Math.abs(p.x - hx[j]) < tolerance && Math.abs(p.y - hy[i]) < tolerance) {
          return type;
        }
      }
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isSpacePressed || e.button === 1) {
      setIsPanning(true);
      setStartPoint(getScreenCoords(e));
      return;
    }

    const p = getCanvasCoords(e);

    if (selection) {
      const handle = getHandleAt(p, selection);
      if (handle) {
        setIsResizingSelection(true);
        setDragType(handle);
        setStartPoint(p);
        return;
      }
    }

    const clickedOverlay = [...slide.overlays].reverse().find((o) => isPointInRect(p, o.rect));
    if (clickedOverlay) {
      onOverlaySelect(clickedOverlay.id);
      setIsDraggingOverlay(true);
      setStartPoint(p);
      setSelection(null);
      onSelectionChange(null);
      return;
    }

    onOverlaySelect(null);
    setIsDrawing(true);
    const nextSelection = { x: p.x, y: p.y, width: 0, height: 0 };
    setSelection(nextSelection);
    setStartPoint(p);
    onSelectionChange(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const screenP = getScreenCoords(e);
    const canvasP = getCanvasCoords(e);

    if (canvasRef.current) {
      if (isSpacePressed || isPanning) canvasRef.current.style.cursor = isPanning ? "grabbing" : "grab";
      else if (isDraggingOverlay) canvasRef.current.style.cursor = "grabbing";
      else if (isResizingSelection) canvasRef.current.style.cursor = "nwse-resize";
      else if (slide.overlays.some((o) => isPointInRect(canvasP, o.rect))) canvasRef.current.style.cursor = "pointer";
      else if (selection && getHandleAt(canvasP, selection)) canvasRef.current.style.cursor = "crosshair";
      else canvasRef.current.style.cursor = "default";
    }

    if (isPanning && startPoint) {
      const dx = screenP.x - startPoint.x;
      const dy = screenP.y - startPoint.y;
      setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      setStartPoint(screenP);
      return;
    }

    if (isDrawing && startPoint) {
      const x = Math.min(canvasP.x, startPoint.x);
      const y = Math.min(canvasP.y, startPoint.y);
      const width = Math.abs(canvasP.x - startPoint.x);
      const height = Math.abs(canvasP.y - startPoint.y);
      setSelection({ x, y, width, height });
    } else if (isResizingSelection && selection && startPoint && dragType) {
      const dx = canvasP.x - startPoint.x;
      const dy = canvasP.y - startPoint.y;
      const nextRect = { ...selection };

      if (dragType.includes("e")) nextRect.width += dx;
      if (dragType.includes("w")) {
        nextRect.x += dx;
        nextRect.width -= dx;
      }
      if (dragType.includes("s")) nextRect.height += dy;
      if (dragType.includes("n")) {
        nextRect.y += dy;
        nextRect.height -= dy;
      }

      setSelection(nextRect);
      setStartPoint(canvasP);
    } else if (isDraggingOverlay && selectedOverlayId && startPoint) {
      const dx = canvasP.x - startPoint.x;
      const dy = canvasP.y - startPoint.y;
      const nextOverlays = slide.overlays.map((ov) =>
        ov.id === selectedOverlayId
          ? { ...ov, rect: { ...ov.rect, x: ov.rect.x + dx, y: ov.rect.y + dy } }
          : ov
      );
      onUpdateOverlays(nextOverlays);
      setStartPoint(canvasP);
    }
  };

  const handleMouseUp = () => {
    if (isDrawing || isResizingSelection) {
      if (selection && (selection.width < MIN_RECT_SIZE || selection.height < MIN_RECT_SIZE)) {
        setSelection(null);
        onSelectionChange(null);
      } else {
        onSelectionChange(selection);
      }
    }

    setIsDrawing(false);
    setIsDraggingOverlay(false);
    setIsResizingSelection(false);
    setIsPanning(false);
    setStartPoint(null);
  };

  return (
    <div ref={containerRef} className="relative flex flex-1 items-center justify-center overflow-hidden bg-muted/20 select-none">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        className="block h-full w-full"
      />
      <div className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-full border bg-background/90 px-4 py-2 text-xs text-muted-foreground backdrop-blur">
        <span>Space + Drag / Arrow: 이동</span>
        <span>드래그: 영역 선택</span>
      </div>
    </div>
  );
};

export default EditorCanvas;
