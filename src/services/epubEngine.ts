import JSZip from 'jszip';

export interface EpubChapter {
  id: string;
  title: string;
  html: string;
}

export interface ParsedEpub {
  title: string;
  author: string;
  coverDataUrl?: string;
  chapters: EpubChapter[];
  assetUrls: string[]; // track blob URLs to revoke on cleanup
}

function resolvePath(baseDir: string, relativePath: string): string {
  const cleanRel = decodeURIComponent(relativePath).split('#')[0];
  if (!baseDir) return cleanRel.replace(/^\/+/, '');
  const baseParts = baseDir.split('/').filter(Boolean);
  const relParts = cleanRel.split('/');
  for (const part of relParts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }
  return baseParts.join('/');
}

function getMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sanitizeChapterHtml(rawHtml: string, chapterDir: string, imageMap: Map<string, string>): {
  title?: string;
  bodyHtml: string;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'application/xhtml+xml');
  const isXmlError = doc.querySelector('parsererror');
  const parsedDoc = isXmlError
    ? parser.parseFromString(rawHtml, 'text/html')
    : doc;

  // Extract chapter title
  const heading = parsedDoc.querySelector('h1, h2, h3, title');
  const title = heading?.textContent?.trim() || undefined;

  const body = parsedDoc.body || parsedDoc.documentElement;
  if (!body) {
    return { title, bodyHtml: '<p>Không có nội dung hiển thị.</p>' };
  }

  // Strip potentially unsafe or layout-breaking tags
  body.querySelectorAll('script, style, link, meta, iframe, object').forEach((el) => el.remove());

  // Resolve image sources inside chapter to in-memory Blob URLs
  body.querySelectorAll('img, image').forEach((img) => {
    const src = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttribute('href');
    if (src && !src.startsWith('data:') && !src.startsWith('http')) {
      const resolved = resolvePath(chapterDir, src);
      const blobUrl = imageMap.get(resolved) || imageMap.get(resolved.toLowerCase());
      if (blobUrl) {
        if (img.tagName.toLowerCase() === 'img') {
          img.setAttribute('src', blobUrl);
          img.setAttribute('style', 'max-width: 100%; height: auto; display: block; margin: 1em auto; border-radius: 4px;');
        }
      }
    }
  });

  // Clean inline fixed font-colors/backgrounds so reader night mode & paper textures work properly
  body.querySelectorAll('[style]').forEach((el) => {
    if (el.tagName.toLowerCase() === 'img') return;
    const style = el.getAttribute('style') || '';
    const cleaned = style
      .replace(/color\s*:[^;]+;?/gi, '')
      .replace(/background(-color)?\s*:[^;]+;?/gi, '')
      .replace(/font-family\s*:[^;]+;?/gi, '');
    if (cleaned.trim()) {
      el.setAttribute('style', cleaned);
    } else {
      el.removeAttribute('style');
    }
  });

  return {
    title,
    bodyHtml: body.innerHTML,
  };
}

export async function parseEpubBuffer(buffer: ArrayBuffer): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(buffer);
  const assetUrls: string[] = [];

  // 1. Locate OPF via META-INF/container.xml
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    throw new Error('Tệp EPUB không hợp lệ (thiếu META-INF/container.xml)');
  }
  const containerXml = await containerFile.async('text');
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, 'application/xml');
  const rootfileEl = containerDoc.querySelector('rootfile');
  const opfPath = rootfileEl?.getAttribute('full-path');
  if (!opfPath) {
    throw new Error('Không tìm thấy tệp định nghĩa OPF trong EPUB');
  }

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error(`Không tìm thấy tệp ${opfPath}`);
  }

  const opfText = await opfFile.async('text');
  const opfDoc = parser.parseFromString(opfText, 'application/xml');

  const titleEl = opfDoc.querySelector('metadata title, dc\\:title');
  const authorEl = opfDoc.querySelector('metadata creator, dc\\:creator');
  const title = titleEl?.textContent?.trim() || 'Sách EPUB chưa rõ tên';
  const author = authorEl?.textContent?.trim() || 'Khuyết danh';

  // 2. Build manifest map
  const manifestMap = new Map<string, { href: string; mediaType: string; properties: string }>();
  opfDoc.querySelectorAll('manifest > item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type') || '';
    const properties = item.getAttribute('properties') || '';
    if (id && href) {
      manifestMap.set(id, { href, mediaType, properties });
    }
  });

  // 3. Extract cover image if present
  let coverDataUrl: string | undefined;
  let coverHref: string | undefined;

  const metaCover = opfDoc.querySelector('metadata meta[name="cover"]');
  const metaCoverId = metaCover?.getAttribute('content');
  if (metaCoverId && manifestMap.has(metaCoverId)) {
    coverHref = manifestMap.get(metaCoverId)?.href;
  }
  if (!coverHref) {
    for (const [, item] of manifestMap) {
      if (item.properties.includes('cover-image')) {
        coverHref = item.href;
        break;
      }
    }
  }
  if (!coverHref) {
    for (const [id, item] of manifestMap) {
      if (item.mediaType.startsWith('image/') && id.toLowerCase().includes('cover')) {
        coverHref = item.href;
        break;
      }
    }
  }

  if (coverHref) {
    const fullCoverPath = resolvePath(opfDir, coverHref);
    const coverEntry = zip.file(fullCoverPath);
    if (coverEntry) {
      const coverBytes = await coverEntry.async('blob');
      const typedBlob = new Blob([coverBytes], { type: getMimeType(fullCoverPath) });
      coverDataUrl = await blobToDataUrl(typedBlob);
    }
  }

  // 4. Preload images inside EPUB for chapter rendering
  const imageMap = new Map<string, string>();
  for (const [, item] of manifestMap) {
    if (item.mediaType.startsWith('image/')) {
      const fullImgPath = resolvePath(opfDir, item.href);
      const entry = zip.file(fullImgPath);
      if (entry) {
        const blob = await entry.async('blob');
        const url = URL.createObjectURL(new Blob([blob], { type: item.mediaType }));
        assetUrls.push(url);
        imageMap.set(fullImgPath, url);
        imageMap.set(fullImgPath.toLowerCase(), url);
      }
    }
  }

  // 5. Read spine chapters in order
  const chapters: EpubChapter[] = [];
  const spineRefs = Array.from(opfDoc.querySelectorAll('spine > itemref'));

  for (let i = 0; i < spineRefs.length; i++) {
    const idref = spineRefs[i].getAttribute('idref');
    if (!idref) continue;
    const item = manifestMap.get(idref);
    if (!item) continue;

    const fullPath = resolvePath(opfDir, item.href);
    const entry = zip.file(fullPath);
    if (!entry) continue;

    const chapterDir = fullPath.includes('/') ? fullPath.slice(0, fullPath.lastIndexOf('/')) : '';
    const rawHtml = await entry.async('text');
    const cleaned = sanitizeChapterHtml(rawHtml, chapterDir, imageMap);

    chapters.push({
      id: idref,
      title: cleaned.title || `Chương ${chapters.length + 1}`,
      html: cleaned.bodyHtml,
    });
  }

  if (chapters.length === 0) {
    chapters.push({
      id: 'empty',
      title: title,
      html: '<p>Không tìm thấy nội dung chương đọc trong tệp EPUB này.</p>',
    });
  }

  return {
    title,
    author,
    coverDataUrl,
    chapters,
    assetUrls,
  };
}
