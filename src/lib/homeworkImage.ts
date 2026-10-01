/** Full-width, overlapping sections preserve table columns and question context. */
export function getHomeworkReadingRegions() {
  return [0, 30, 60].map(y => ({ x: 0, y, width: 100, height: 40 }));
}

/** Avoid artificial upscaling; bound payloads while retaining text detail. */
export function getHomeworkImageSize(width: number, height: number, maxSide = 2400) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
