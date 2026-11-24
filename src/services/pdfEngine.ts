import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { SmartZoomMode } from '../types/reader';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfLoadResult {
  doc: pdfjsLib.PDFDocumentProxy;
  numPages: number;
  title?: string;
  author?: string;
}

export async function loadPdfDocument(buffer: ArrayBuffer): Promise<PdfLoadResult> {
  const copy = buffer.slice(0);
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(copy),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  let title: string | undefined;
  let author: string | undefined;
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as Record<string, unknown> | undefined;
    if (info?.Title && typeof info.Title === 'string' && info.Title.trim()) {
      title = info.Title.trim();
    }
    if (info?.Author && typeof info.Author === 'string' && info.Author.trim()) {
      author = info.Author.trim();
    }
  } catch {
    // Ignore optional metadata parsing errors
  }

  return {
    doc,
    numPages: doc.numPages,
    title,
    author,
  };
}

export async function extractPdfCover(buffer: ArrayBuffer): Promise<{
  coverDataUrl?: string;
  pageCount: number;
  title?: string;
  author?: string;
}> {
  const { doc, numPages, title, author } = await loadPdfDocument(buffer);
  let coverDataUrl: string | undefined;

  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const targetWidth = 360;
    const scale = targetWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(scaledViewport.width);
    canvas.height = Math.round(scaledViewport.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: scaledViewport, canvas }).promise;
      coverDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    }
  } catch {
    // Cover extraction optional
  } finally {
    await doc.cleanup();
  }

  return { coverDataUrl, pageCount: numPages, title, author };
}

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Scans rendered page pixels to trim empty white PDF margins automatically.
 * Dramatically increases text legibility on small 5.5" 1280x720 screens.
 */
function detectInkBoundingBox(canvas: HTMLCanvasElement): CropBox {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }

  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const step = 2; // fast 2px sampling
  const threshold = 242; // near-white cutoff

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      if (r < threshold || g < threshold || b < threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    return { x: 0, y: 0, width, height };
  }

  // Add comfortable 3.5% breathing margin around detected content
  const padX = Math.round(width * 0.035);
  const padY = Math.round(height * 0.035);

  const cx = Math.max(0, minX - padX);
  const cy = Math.max(0, minY - padY);
  const cw = Math.min(width - cx, maxX - minX + padX * 2);
  const ch = Math.min(height - cy, maxY - minY + padY * 2);

  // Only crop if we actually save meaningful whitespace (>10% area)
  if (cw * ch > width * height * 0.92) {
    return { x: 0, y: 0, width, height };
  }

  return { x: cx, y: cy, width: cw, height: ch };
}

export interface RenderPdfPageOptions {
  doc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  targetCanvas: HTMLCanvasElement;
  containerWidth: number;
  containerHeight: number;
  zoomMode: SmartZoomMode;
  manualZoom: number;
}

export async function renderPdfPageToCanvas({
  doc,
  pageNumber,
  targetCanvas,
  containerWidth,
  containerHeight,
  zoomMode,
  manualZoom,
}: RenderPdfPageOptions): Promise<{ renderedWidth: number; renderedHeight: number; autoCropped: boolean }> {
  const page = await doc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (zoomMode === 'auto-crop') {
    // First render at a crisp analysis resolution to detect white borders
    const probeScale = Math.max(1.4, Math.min(2.2, (containerWidth * 1.5) / baseViewport.width));
    const probeViewport = page.getViewport({ scale: probeScale });
    const offscreen = document.createElement('canvas');
    offscreen.width = Math.round(probeViewport.width);
    offscreen.height = Math.round(probeViewport.height);
    const offCtx = offscreen.getContext('2d');

    if (offCtx) {
      offCtx.fillStyle = '#ffffff';
      offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
      await page.render({ canvasContext: offCtx, viewport: probeViewport, canvas: offscreen }).promise;

      const crop = detectInkBoundingBox(offscreen);
      const fitScale = Math.min(
        containerWidth / crop.width,
        containerHeight / crop.height
      );
      const finalW = Math.max(1, Math.round(crop.width * fitScale));
      const finalH = Math.max(1, Math.round(crop.height * fitScale));

      // Re-render at sharp high-DPI scale if needed
      const desiredTotalScale = (finalW * dpr) / (crop.width / probeScale);
      const hiResViewport = page.getViewport({ scale: Math.min(3.5, desiredTotalScale) });
      const ratio = hiResViewport.scale / probeScale;

      const hiOffscreen = document.createElement('canvas');
      hiOffscreen.width = Math.round(hiResViewport.width);
      hiOffscreen.height = Math.round(hiResViewport.height);
      const hiCtx = hiOffscreen.getContext('2d');

      targetCanvas.width = Math.round(finalW * dpr);
      targetCanvas.height = Math.round(finalH * dpr);
      targetCanvas.style.width = `${finalW}px`;
      targetCanvas.style.height = `${finalH}px`;

      const outCtx = targetCanvas.getContext('2d');
      if (hiCtx && outCtx) {
        hiCtx.fillStyle = '#ffffff';
        hiCtx.fillRect(0, 0, hiOffscreen.width, hiOffscreen.height);
        await page.render({ canvasContext: hiCtx, viewport: hiResViewport, canvas: hiOffscreen }).promise;

        outCtx.fillStyle = '#ffffff';
        outCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
        outCtx.drawImage(
          hiOffscreen,
          crop.x * ratio,
          crop.y * ratio,
          crop.width * ratio,
          crop.height * ratio,
          0,
          0,
          targetCanvas.width,
          targetCanvas.height
        );

        return {
          renderedWidth: finalW,
          renderedHeight: finalH,
          autoCropped: crop.width < offscreen.width * 0.95 || crop.height < offscreen.height * 0.95,
        };
      }
    }
  }

  let cssScale = 1;
  if (zoomMode === 'fit-page') {
    cssScale = Math.min(
      containerWidth / baseViewport.width,
      containerHeight / baseViewport.height
    );
  } else if (zoomMode === 'fit-width') {
    cssScale = containerWidth / baseViewport.width;
  } else {
    // manual zoom relative to fit-page baseline
    const fitBaseline = Math.min(
      containerWidth / baseViewport.width,
      containerHeight / baseViewport.height
    );
    cssScale = fitBaseline * manualZoom;
  }

  const displayW = Math.max(1, Math.round(baseViewport.width * cssScale));
  const displayH = Math.max(1, Math.round(baseViewport.height * cssScale));

  const renderViewport = page.getViewport({ scale: cssScale * dpr });
  targetCanvas.width = Math.round(renderViewport.width);
  targetCanvas.height = Math.round(renderViewport.height);
  targetCanvas.style.width = `${displayW}px`;
  targetCanvas.style.height = `${displayH}px`;

  const ctx = targetCanvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    await page.render({ canvasContext: ctx, viewport: renderViewport, canvas: targetCanvas }).promise;
  }

  return { renderedWidth: displayW, renderedHeight: displayH, autoCropped: false };
}
