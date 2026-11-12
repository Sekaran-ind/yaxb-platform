// Turn an uploaded file into notebook text, in the browser. Nothing is uploaded to the server.
// Text, Markdown, CSV and JSON are read as they are; HTML is reduced to its text; PDF is read with
// pdf.js (loaded only when a PDF is added). Scanned PDFs have no text layer and are refused.
import { NOTEBOOK_LIMITS } from "@sekaran-ind/yaxb-core/notebook";

export const ACCEPTED_FILES = ".txt,.md,.markdown,.csv,.json,.html,.htm,.pdf,text/plain,text/markdown,text/csv,application/json,text/html,application/pdf";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type ReadDocument = { title: string; mime: string; text: string; truncated: boolean };

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").trim());
    if (pages.join("\n\n").length > NOTEBOOK_LIMITS.sourceChars) break;
  }
  await task.destroy();
  return pages.filter(Boolean).join("\n\n");
}

function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,template").forEach((n) => n.remove());
  return (doc.body?.innerText ?? doc.body?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export async function readDocument(file: File): Promise<ReadDocument> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over 20 MB.`);
  const name = file.name.toLowerCase();
  let text: string;
  let mime = file.type || "text/plain";
  if (name.endsWith(".pdf") || mime === "application/pdf") {
    text = await pdfText(file);
    mime = "application/pdf";
    if (!text.trim()) throw new Error(`${file.name} has no text layer (it may be a scan). Try a text-based PDF.`);
  } else if (name.endsWith(".html") || name.endsWith(".htm") || mime === "text/html") {
    text = htmlText(await file.text());
    mime = "text/html";
  } else if (/\.(txt|md|markdown|csv|json)$/.test(name) || mime.startsWith("text/") || mime === "application/json") {
    text = await file.text();
  } else {
    throw new Error(`${file.name}: add text, Markdown, CSV, JSON, HTML or PDF files.`);
  }
  text = text.replace(/\r\n/g, "\n").trim();
  if (!text) throw new Error(`${file.name} is empty.`);
  const truncated = text.length > NOTEBOOK_LIMITS.sourceChars;
  return { title: file.name.replace(/\.[^.]+$/, "").slice(0, NOTEBOOK_LIMITS.titleChars), mime, text: truncated ? text.slice(0, NOTEBOOK_LIMITS.sourceChars) : text, truncated };
}
