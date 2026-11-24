import JSZip from 'jszip';

/**
 * Generates a real valid multi-page EPUB binary buffer offline via JSZip.
 */
export async function buildSampleEpub(options: {
  title: string;
  author: string;
  chapters: Array<{ title: string; paragraphs: string[] }>;
}): Promise<ArrayBuffer> {
  const zip = new JSZip();

  // mimetype MUST be stored uncompressed as first entry per EPUB spec
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  const manifestItems = options.chapters
    .map(
      (_, idx) =>
        `<item id="chap${idx + 1}" href="chap${idx + 1}.xhtml" media-type="application/xhtml+xml"/>`
    )
    .join('\n    ');

  const spineItems = options.chapters
    .map((_, idx) => `<itemref idref="chap${idx + 1}"/>`)
    .join('\n    ');

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    <dc:title>${escapeXml(options.title)}</dc:title>
    <dc:creator>${escapeXml(options.author)}</dc:creator>
    <dc:language>vi</dc:language>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`
  );

  options.chapters.forEach((chap, idx) => {
    const bodyParas = chap.paragraphs.map((p) => `<p>${escapeXml(p)}</p>`).join('\n    ');
    zip.file(
      `OEBPS/chap${idx + 1}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="vi">
<head>
  <title>${escapeXml(chap.title)}</title>
</head>
<body>
  <h1>${escapeXml(chap.title)}</h1>
  ${bodyParas}
</body>
</html>`
    );
  });

  return zip.generateAsync({ type: 'arraybuffer' });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates a real valid multi-page PDF 1.4 binary buffer with clean typography,
 * generous page margins (ideal for testing Smart Auto-Crop), and crisp diagrams.
 * Uses ASCII/WinAnsi encoding cleanly via Helvetica & Courier standard PDF fonts.
 */
export function buildSamplePdf(options: {
  title: string;
  author: string;
  pages: Array<{ heading: string; lines: string[]; accentBox?: string }>;
}): ArrayBuffer {
  const objects: string[] = [];

  // Object 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Object 2: Pages placeholder (filled after creating page objects)
  objects.push('');

  // Object 3: Font Helvetica
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');

  // Object 4: Font Helvetica-Bold
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n');

  // Object 5: Font Courier
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\nendobj\n');

  const pageIds: number[] = [];
  let nextObjId = 6;

  options.pages.forEach((pageData, pageIdx) => {
    const pageObjId = nextObjId++;
    const contentObjId = nextObjId++;
    pageIds.push(pageObjId);

    const streamLines: string[] = [];
    // Subtle outer border inside wide margins (so Auto-Crop shows real margin trimming!)
    streamLines.push('0.82 0.79 0.74 RG');
    streamLines.push('0.8 w');
    streamLines.push('68 72 460 698 re S');

    // Header running title
    streamLines.push('BT');
    streamLines.push('/F1 9 Tf');
    streamLines.push('0.45 0.42 0.38 rg');
    streamLines.push(`86 742 Td (${pdfEscape(options.title)}) Tj`);
    streamLines.push('ET');

    // Page heading
    streamLines.push('BT');
    streamLines.push('/F2 17 Tf');
    streamLines.push('0.12 0.11 0.10 rg');
    streamLines.push(`86 704 Td (${pdfEscape(pageData.heading)}) Tj`);
    streamLines.push('ET');

    // Divider line
    streamLines.push('0.76 0.65 0.45 RG');
    streamLines.push('1.2 w');
    streamLines.push('86 692 m 510 692 l S');

    // Body lines
    let cursorY = 664;
    pageData.lines.forEach((line) => {
      if (line.trim() === '') {
        cursorY -= 12;
        return;
      }
      const isBullet = line.startsWith('- ') || line.startsWith('[');
      streamLines.push('BT');
      streamLines.push(isBullet ? '/F3 10.5 Tf' : '/F1 11.5 Tf');
      streamLines.push('0.16 0.15 0.14 rg');
      streamLines.push(`86 ${cursorY} Td (${pdfEscape(line)}) Tj`);
      streamLines.push('ET');
      cursorY -= 19;
    });

    if (pageData.accentBox) {
      const boxY = Math.max(120, cursorY - 56);
      streamLines.push('0.96 0.94 0.89 rg');
      streamLines.push(`86 ${boxY} 424 44 re f`);
      streamLines.push('0.72 0.56 0.32 RG');
      streamLines.push('0.8 w');
      streamLines.push(`86 ${boxY} 424 44 re S`);
      streamLines.push('BT');
      streamLines.push('/F2 10 Tf');
      streamLines.push('0.35 0.25 0.12 rg');
      streamLines.push(`98 ${boxY + 18} Td (${pdfEscape(pageData.accentBox)}) Tj`);
      streamLines.push('ET');
    }

    // Footer page number
    streamLines.push('BT');
    streamLines.push('/F3 9.5 Tf');
    streamLines.push('0.45 0.42 0.38 rg');
    streamLines.push(`270 92 Td (Page ${pageIdx + 1} / ${options.pages.length}) Tj`);
    streamLines.push('ET');

    const streamStr = streamLines.join('\n');
    objects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`
    );
    objects.push(
      `${contentObjId} 0 obj\n<< /Length ${streamStr.length} >>\nstream\n${streamStr}\nendstream\nendobj\n`
    );
  });

  objects[1] = `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>\nendobj\n`;

  let pdfStr = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(pdfStr.length);
    pdfStr += obj;
  }

  const xrefOffset = pdfStr.length;
  pdfStr += `xref\n0 ${objects.length + 1}\n`;
  pdfStr += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdfStr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdfStr += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (${pdfEscape(options.title)}) /Author (${pdfEscape(options.author)}) >> >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const bytes = new Uint8Array(pdfStr.length);
  for (let i = 0; i < pdfStr.length; i++) {
    bytes[i] = pdfStr.charCodeAt(i) & 0xff;
  }
  return bytes.buffer;
}

function pdfEscape(str: string): string {
  // Normalize Vietnamese diacritics for standard Helvetica WinAnsi PDF font in offline sample generator
  // (User-imported PDFs with embedded UTF-8/CID fonts render full Unicode Vietnamese natively via pdfjs-dist!)
  const asciiSafe = str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
  return asciiSafe
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}
