import { renderTextOverlay } from "@/lib/overlayRenderer";
import type { SlideData } from "../types";

declare const pdfjsLib: any;
declare const jspdf: any;
declare const PptxGenJS: any;

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const renderSlideToCanvas = async (slide: SlideData) => {
  const canvas = document.createElement("canvas");
  canvas.width = slide.width;
  canvas.height = slide.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to initialize canvas context.");

  const img = new Image();
  img.src = slide.dataUrl;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("Failed to load slide image."));
  });

  ctx.drawImage(img, 0, 0);
  slide.overlays.forEach((overlay) => {
    renderTextOverlay(ctx, overlay);
  });

  return canvas;
};

const ensurePptxExtension = (filename: string) =>
  filename.toLowerCase().endsWith(".pptx") ? filename : `${filename}.pptx`;

export const convertPdfToImages = async (file: File): Promise<SlideData[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const slides: SlideData[] = [];

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport }).promise;

    slides.push({
      index: i - 1,
      dataUrl: canvas.toDataURL("image/png"),
      width: viewport.width,
      height: viewport.height,
      overlays: [],
    });
  }

  return slides;
};

export const downloadAsPdf = (slides: SlideData[], filename: string) => {
  if (slides.length === 0) return;

  const { jsPDF } = jspdf;
  const doc = new jsPDF({
    orientation: slides[0].width > slides[0].height ? "landscape" : "portrait",
    unit: "px",
    format: [slides[0].width, slides[0].height],
  });

  const saveAll = async () => {
    for (let i = 0; i < slides.length; i += 1) {
      const slide = slides[i];
      if (i > 0) doc.addPage([slide.width, slide.height]);
      const canvas = await renderSlideToCanvas(slide);
      const finalDataUrl = canvas.toDataURL("image/jpeg", 0.95);
      doc.addImage(finalDataUrl, "JPEG", 0, 0, slide.width, slide.height);
    }
    doc.save(filename);
  };

  saveAll();
};

export const downloadAsPptx = async (slides: SlideData[], filename: string) => {
  if (slides.length === 0) return;
  if (typeof PptxGenJS === "undefined") {
    throw new Error("PptxGenJS is not loaded.");
  }

  const pptx = new PptxGenJS();
  const baseWidthIn = slides[0].width / 96;
  const baseHeightIn = slides[0].height / 96;

  if (typeof pptx.defineLayout === "function") {
    pptx.defineLayout({
      name: "SLIDECHANGE_CUSTOM",
      width: baseWidthIn,
      height: baseHeightIn,
    });
    pptx.layout = "SLIDECHANGE_CUSTOM";
  }

  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i];
    const canvas = await renderSlideToCanvas(slide);
    const imageData = canvas.toDataURL("image/png");
    const pptSlide = pptx.addSlide();

    const srcRatio = slide.width / slide.height;
    const dstRatio = baseWidthIn / baseHeightIn;
    let drawW = baseWidthIn;
    let drawH = baseHeightIn;
    let drawX = 0;
    let drawY = 0;

    if (srcRatio > dstRatio) {
      drawH = baseWidthIn / srcRatio;
      drawY = (baseHeightIn - drawH) / 2;
    } else if (srcRatio < dstRatio) {
      drawW = baseHeightIn * srcRatio;
      drawX = (baseWidthIn - drawW) / 2;
    }

    pptSlide.addImage({
      data: imageData,
      x: drawX,
      y: drawY,
      w: drawW,
      h: drawH,
    });
  }

  await pptx.writeFile({ fileName: ensurePptxExtension(filename) });
};
