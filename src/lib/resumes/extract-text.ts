import { extractText as unpdfExtractText } from "unpdf";
import mammoth from "mammoth";

/**
 * Extract plain text from an uploaded resume file (PDF, DOCX, DOC, TXT).
 * Runs in the Node runtime (API route / worker) — not Edge.
 */
export async function extractResumeText(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  const lower = fileName.toLowerCase();

  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    const { text } = await unpdfExtractText(new Uint8Array(buffer), {
      mergePages: true,
    });
    return normalizeWhitespace(text);
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    const { value } = await mammoth.extractRawText({ buffer });
    return normalizeWhitespace(value);
  }

  if (mimeType === "text/plain" || lower.endsWith(".txt")) {
    return normalizeWhitespace(buffer.toString("utf8"));
  }

  throw new Error(
    `Unsupported resume format: ${mimeType}. Upload a PDF, DOCX, or TXT file.`
  );
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
