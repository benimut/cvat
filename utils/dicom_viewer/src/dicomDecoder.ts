import dicomParser from 'dicom-parser';

/**
 * 第一幀解碼結果，僅包含記憶體中的畫布、檔案名稱與總幀數
 */
export interface DecodedFirstFrame {
  fileName: string;
  canvas: HTMLCanvasElement;
  frameCount: number;
}

/**
 * 從 DICOM DataSet 擷取影像總幀數 (0028,0008 Number of Frames)，無效或缺失時預設回傳 1
 */
export function extractFrameCount(dataSet: dicomParser.DataSet): number {
  const raw = dataSet.string('x00280008')?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  return parsed > 0 ? parsed : 1;
}

/**
 * 將數值限制在 0 到 255 之間
 */
function clampByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

/**
 * 將單一幀的封裝 JPEG 位元組透過瀏覽器原生解碼器繪製至畫布
 */
async function decodeJpegFirstFrame(jpegBytes: Uint8Array): Promise<HTMLCanvasElement> {
  const safeCopy = new Uint8Array(jpegBytes.byteLength);
  safeCopy.set(jpegBytes);
  const blob = new Blob([safeCopy], { type: 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('無法建立 2D 畫布內容');
    }
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    // 立即釋放 ImageBitmap，避免記憶體殘留
    bitmap.close();
  }
}

/**
 * 從封裝的 PixelData 中僅擷取第一幀的位元組序列
 */
function extractEncapsulatedFirstFrame(
  dataSet: dicomParser.DataSet,
  pixelDataElement: dicomParser.Element
): Uint8Array {
  const fragments = pixelDataElement.fragments;
  if (!fragments || fragments.length === 0) {
    throw new Error('找不到封裝像素片段');
  }

  // 若 Basic Offset Table 存在，直接交由 dicom-parser 讀取第 0 幀
  if (pixelDataElement.basicOffsetTable && pixelDataElement.basicOffsetTable.length > 0) {
    return dicomParser.readEncapsulatedImageFrame(dataSet, pixelDataElement, 0);
  }

  // 若無 Basic Offset Table，從第 0 個 fragment 開始收集直到出現 JPEG EOI (0xFF 0xD9)
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i];
    const slice = dataSet.byteArray.subarray(frag.position, frag.position + frag.length);
    chunks.push(slice);
    totalLength += slice.length;

    // 檢查尾端是否為 JPEG 結束標記 FF D9（允許尾端補 0 padding byte）
    if (slice.length >= 2) {
      const last = slice[slice.length - 1];
      const prev = slice[slice.length - 2];
      const prev2 = slice.length >= 3 ? slice[slice.length - 3] : 0;
      if ((prev === 0xff && last === 0xd9) || (prev2 === 0xff && prev === 0xd9 && last === 0x00)) {
        break;
      }
    }
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/**
 * 解碼未壓縮的單幀像素資料（支援 RGB、YBR_FULL、YBR_FULL_422、MONOCHROME1/2）
 */
function decodeUncompressedFirstFrame(
  dataSet: dicomParser.DataSet,
  pixelDataElement: dicomParser.Element,
  rows: number,
  columns: number,
  samplesPerPixel: number,
  bitsAllocated: number,
  photometric: string,
  planarConfiguration: number,
  pixelRepresentation: number
): HTMLCanvasElement {
  const pixelCount = rows * columns;
  const bytesPerSample = Math.max(1, bitsAllocated >> 3);
  const startOffset = pixelDataElement.dataOffset;

  const canvas = document.createElement('canvas');
  canvas.width = columns;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('無法建立 2D 畫布內容');
  }

  const imageData = ctx.createImageData(columns, rows);
  const rgba = imageData.data;

  if (samplesPerPixel === 3 && (photometric === 'RGB' || photometric === 'YBR_FULL')) {
    const expectedBytes = pixelCount * 3;
    if (startOffset + expectedBytes > dataSet.byteArray.length) {
      throw new Error('像素資料長度不足');
    }

    const src = dataSet.byteArray.subarray(startOffset, startOffset + expectedBytes);
    const isYbr = photometric === 'YBR_FULL';

    for (let i = 0; i < pixelCount; i++) {
      let c0: number;
      let c1: number;
      let c2: number;

      if (planarConfiguration === 1) {
        c0 = src[i];
        c1 = src[pixelCount + i];
        c2 = src[pixelCount * 2 + i];
      } else {
        const idx = i * 3;
        c0 = src[idx];
        c1 = src[idx + 1];
        c2 = src[idx + 2];
      }

      const dstIdx = i * 4;
      if (isYbr) {
        // DICOM PS3.3 YBR_FULL 轉換至 RGB
        const cb = c1 - 128;
        const cr = c2 - 128;
        rgba[dstIdx] = clampByte(c0 + 1.402 * cr);
        rgba[dstIdx + 1] = clampByte(c0 - 0.344136 * cb - 0.714136 * cr);
        rgba[dstIdx + 2] = clampByte(c0 + 1.772 * cb);
      } else {
        rgba[dstIdx] = c0;
        rgba[dstIdx + 1] = c1;
        rgba[dstIdx + 2] = c2;
      }
      rgba[dstIdx + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  if (photometric === 'YBR_FULL_422') {
    // 未壓縮 YBR_FULL_422 每兩個水平相鄰像素共用 Cb/Cr（共 4 bytes: Y1, Y2, Cb, Cr）
    const expectedBytes = pixelCount * 2;
    if (startOffset + expectedBytes > dataSet.byteArray.length) {
      throw new Error('YBR_FULL_422 像素資料長度不足');
    }

    const src = dataSet.byteArray.subarray(startOffset, startOffset + expectedBytes);
    for (let i = 0; i < pixelCount; i += 2) {
      const srcIdx = i * 2;
      const y1 = src[srcIdx];
      const y2 = src[srcIdx + 1];
      const cb = src[srcIdx + 2] - 128;
      const cr = src[srcIdx + 3] - 128;

      const d1 = i * 4;
      rgba[d1] = clampByte(y1 + 1.402 * cr);
      rgba[d1 + 1] = clampByte(y1 - 0.344136 * cb - 0.714136 * cr);
      rgba[d1 + 2] = clampByte(y1 + 1.772 * cb);
      rgba[d1 + 3] = 255;

      if (i + 1 < pixelCount) {
        const d2 = (i + 1) * 4;
        rgba[d2] = clampByte(y2 + 1.402 * cr);
        rgba[d2 + 1] = clampByte(y2 - 0.344136 * cb - 0.714136 * cr);
        rgba[d2 + 2] = clampByte(y2 + 1.772 * cb);
        rgba[d2 + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // 單色灰階（MONOCHROME1 / MONOCHROME2）
  const expectedBytes = pixelCount * bytesPerSample;
  if (startOffset + expectedBytes > dataSet.byteArray.length) {
    throw new Error('灰階像素資料長度不足');
  }

  const invert = photometric === 'MONOCHROME1';
  const view = new DataView(
    dataSet.byteArray.buffer,
    dataSet.byteArray.byteOffset + startOffset,
    expectedBytes
  );

  if (bytesPerSample === 1) {
    const src = dataSet.byteArray.subarray(startOffset, startOffset + expectedBytes);
    for (let i = 0; i < pixelCount; i++) {
      const val = invert ? 255 - src[i] : src[i];
      const dstIdx = i * 4;
      rgba[dstIdx] = val;
      rgba[dstIdx + 1] = val;
      rgba[dstIdx + 2] = val;
      rgba[dstIdx + 3] = 255;
    }
  } else {
    // 16-bit 灰階依第一幀 min/max 正規化至 0..255
    const isSigned = pixelRepresentation === 1;
    let minVal = Infinity;
    let maxVal = -Infinity;
    const values = new Float32Array(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      const raw = isSigned ? view.getInt16(i * 2, true) : view.getUint16(i * 2, true);
      values[i] = raw;
      if (raw < minVal) minVal = raw;
      if (raw > maxVal) maxVal = raw;
    }

    const range = maxVal - minVal || 1;
    for (let i = 0; i < pixelCount; i++) {
      let norm = ((values[i] - minVal) / range) * 255;
      if (invert) norm = 255 - norm;
      const gray = clampByte(norm);
      const dstIdx = i * 4;
      rgba[dstIdx] = gray;
      rgba[dstIdx + 1] = gray;
      rgba[dstIdx + 2] = gray;
      rgba[dstIdx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 解析單一 DICOM 檔案並僅回傳第一幀預覽畫布；若非有效影像 DICOM 則回傳 null
 */
export async function decodeDicomFirstFrame(file: File): Promise<DecodedFirstFrame | null> {
  const buffer = await file.arrayBuffer();
  const byteArray = new Uint8Array(buffer);

  let dataSet: dicomParser.DataSet;
  try {
    dataSet = dicomParser.parseDicom(byteArray);
  } catch {
    // 略過非 DICOM 檔案或無法解析的檔案
    return null;
  }

  const pixelDataElement = dataSet.elements.x7fe00010;
  if (!pixelDataElement) {
    // 略過不含影像像素資料的 DICOM（如 DICOMDIR / 報告檔）
    return null;
  }

  const rows = dataSet.uint16('x00280010');
  const columns = dataSet.uint16('x00280011');
  if (!rows || !columns) {
    return null;
  }

  const samplesPerPixel = dataSet.uint16('x00280002') ?? 1;
  const bitsAllocated = dataSet.uint16('x00280100') ?? 8;
  const photometric = (dataSet.string('x00280004') ?? 'MONOCHROME2').trim();
  const planarConfiguration = dataSet.uint16('x00280006') ?? 0;
  const pixelRepresentation = dataSet.uint16('x00280103') ?? 0;

  let canvas: HTMLCanvasElement;
  if (pixelDataElement.encapsulatedPixelData) {
    const firstFrameBytes = extractEncapsulatedFirstFrame(dataSet, pixelDataElement);
    canvas = await decodeJpegFirstFrame(firstFrameBytes);
  } else {
    canvas = decodeUncompressedFirstFrame(
      dataSet,
      pixelDataElement,
      rows,
      columns,
      samplesPerPixel,
      bitsAllocated,
      photometric,
      planarConfiguration,
      pixelRepresentation
    );
  }

  return {
    fileName: file.name,
    canvas,
    frameCount: extractFrameCount(dataSet),
  };
}
