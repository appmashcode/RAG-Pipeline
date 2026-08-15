const fs = require('fs/promises');
const path = require('path');

const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

const SUPPORTED = ['.pdf', '.docx', '.txt', '.md'];

/**
 * File se plain text nikaalta hai.
 * PDF ke liye page-wise text bhi return karta hai taake citation me page number aa sake.
 */
async function extractText(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();

  if (!SUPPORTED.includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Supported: ${SUPPORTED.join(', ')}`);
  }

  if (ext === '.pdf') {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      // per-page text milta hai, isliye citation me page number bhi bhej sakte hain
      const result = await parser.getText();
      const pages = (result.pages || []).map((p) => p.text || '');
      return {
        text: pages.length > 0 ? pages.join('\n\n') : result.text || '',
        pages: pages.length > 0 ? pages : null,
        meta: { pageCount: result.total ?? pages.length },
      };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return { text: value, pages: null, meta: {} };
  }

  // .txt / .md
  const text = await fs.readFile(filePath, 'utf8');
  return { text, pages: null, meta: {} };
}

module.exports = { extractText, SUPPORTED };
