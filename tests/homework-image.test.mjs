import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const js = ts.transpileModule(fs.readFileSync('src/lib/homeworkImage.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const helpers = {};
new Function('exports', js)(helpers);

test('photo worksheet table and full-width questions fit in reading views', () => {
  const views = helpers.getHomeworkReadingRegions();
  // Approximate regions from the supplied portrait worksheet; all columns
  // and both multiple-choice columns must be visible together.
  const regions = [
    { x: 8, y: 12, width: 85, height: 18 },
    { x: 5, y: 30, width: 90, height: 10 },
    { x: 4, y: 41, width: 95, height: 11 },
  ];
  for (const box of regions) {
    assert.ok(views.some(v => v.x <= box.x && v.y <= box.y && v.x + v.width >= box.x + box.width && v.y + v.height >= box.y + box.height));
  }
  for (let y = 0; y <= 100; y++) {
    assert.ok(views.some(v => v.y <= y && v.y + v.height >= y));
  }
});

test('large portrait photo retains aspect ratio without artificial upscaling', () => {
  assert.deepEqual(helpers.getHomeworkImageSize(3072, 4096), { width: 1800, height: 2400 });
  assert.deepEqual(helpers.getHomeworkImageSize(800, 600), { width: 800, height: 600 });
  const crop = helpers.getHomeworkImageSize(3072, 1638);
  assert.equal(crop.width, 2400);
  assert.ok(Math.abs(crop.width / crop.height - 3072 / 1638) < 0.002);
});
