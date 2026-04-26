// Tesseract.js wrapper for verifying that the AI-generated tiles actually
// say what the user asked for. Loaded entirely as a lazy chunk via
// dynamic import() in sticker-result, so the 200 KB tesseract.js core +
// 8 MB chi_tra language pack never touch the upload-stage payload.

export interface OcrMismatch {
  index: number;          // 0-based tile position
  expected: string;       // 使用者填的文字
  recognized: string;     // OCR 識別出來的文字(去除空白標點後)
  similarity: number;     // 0–1, Jaccard on character set
}

export interface OcrVerificationResult {
  mismatches: OcrMismatch[];
  totalChecked: number;
  averageSimilarity: number;
  recognizedByIndex: Record<number, string>;
}

export interface OcrVerificationOptions {
  /** How many tiles (out of 24) to OCR. Default 12 — half the grid. */
  sampleSize?: number;
  /** Below this similarity, treat as a mismatch. Default 0.5. */
  similarityThreshold?: number;
  /** Called per-tile so the UI can show a progress bar. */
  onProgress?: (done: number, total: number) => void;
  /** Optional AbortSignal — terminates the worker mid-batch. */
  signal?: AbortSignal;
}

/**
 * Symmetric Jaccard on the character sets of two short strings, after
 * stripping whitespace and Unicode punctuation. Quick, dependency-free,
 * and good enough for "did the model write 收到 or 收吋?" — we don't need
 * Levenshtein for 1–8 char zh-Hant labels.
 */
function characterSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.replace(/[\s\p{P}]/gu, "");
  const aN = norm(a);
  const bN = norm(b);
  if (aN.length === 0 && bN.length === 0) return 1;
  if (aN.length === 0 || bN.length === 0) return 0;
  const aSet = new Set(aN.split(""));
  const bSet = new Set(bN.split(""));
  const intersection = [...aSet].filter((c) => bSet.has(c)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function pickSampleIndices(total: number, sampleSize: number): number[] {
  if (sampleSize >= total) {
    return Array.from({ length: total }, (_, i) => i);
  }
  // Fisher–Yates partial shuffle so the sample is uniform.
  const indices = Array.from({ length: total }, (_, i) => i);
  for (let i = total - 1; i >= total - sampleSize; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(total - sampleSize).sort((a, b) => a - b);
}

export async function verifyTilesOcr(
  tiles: string[],
  expectedTexts: string[],
  options: OcrVerificationOptions = {},
): Promise<OcrVerificationResult> {
  const sampleSize = Math.min(
    tiles.length,
    options.sampleSize ?? Math.min(tiles.length, 12),
  );
  const threshold = options.similarityThreshold ?? 0.5;
  const sampleIndices = pickSampleIndices(tiles.length, sampleSize);

  // Dynamic import keeps tesseract.js out of the main bundle. The library
  // pulls down its language pack (chi_tra ~8 MB) from jsDelivr lazily on
  // first recognize() call.
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("chi_tra", 1, {
    // Default logger logs every recognize step which is noisy; suppress.
    logger: () => undefined,
  });

  const mismatches: OcrMismatch[] = [];
  const recognizedByIndex: Record<number, string> = {};
  let totalSim = 0;

  try {
    for (let n = 0; n < sampleIndices.length; n++) {
      if (options.signal?.aborted) break;

      const tileIdx = sampleIndices[n];
      const expected = expectedTexts[tileIdx] ?? "";
      const tile = tiles[tileIdx];

      const { data } = await worker.recognize(tile);
      const recognized = (data?.text ?? "").trim().replace(/\s+/g, "");
      recognizedByIndex[tileIdx] = recognized;
      const sim = characterSimilarity(expected, recognized);
      totalSim += sim;

      if (sim < threshold) {
        mismatches.push({ index: tileIdx, expected, recognized, similarity: sim });
      }

      options.onProgress?.(n + 1, sampleIndices.length);
    }
  } finally {
    // Always release the worker even on abort/error so we don't leak
    // a hung Web Worker per failed verification.
    try {
      await worker.terminate();
    } catch {
      /* worker already gone */
    }
  }

  return {
    mismatches,
    totalChecked: sampleIndices.length,
    averageSimilarity:
      sampleIndices.length === 0 ? 1 : totalSim / sampleIndices.length,
    recognizedByIndex,
  };
}
