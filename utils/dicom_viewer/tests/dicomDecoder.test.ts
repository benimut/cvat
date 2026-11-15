import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import dicomParser from 'dicom-parser';
import {
  decodeDicomFirstFrame,
  extractFrameCount,
} from '../src/dicomDecoder.ts';

/**
 * 構造 Explicit VR Little Endian 的 DICOM 資料元素位元組
 */
function encodeDicomElement(
  group: number,
  element: number,
  vr: string,
  valueBytes: Uint8Array
): Uint8Array {
  // DICOM 規定元素值長度必須為偶數，若為奇數則依 VR 補齊
  const needsPad = valueBytes.length % 2 !== 0;
  const paddedLength = needsPad ? valueBytes.length + 1 : valueBytes.length;
  const isLongVr =
    vr === 'OB' ||
    vr === 'OW' ||
    vr === 'OF' ||
    vr === 'SQ' ||
    vr === 'UT' ||
    vr === 'UN';

  const headerSize = isLongVr ? 12 : 8;
  const out = new Uint8Array(headerSize + paddedLength);
  const view = new DataView(out.buffer);

  view.setUint16(0, group, true);
  view.setUint16(2, element, true);
  out[4] = vr.charCodeAt(0);
  out[5] = vr.charCodeAt(1);

  if (isLongVr) {
    view.setUint16(6, 0, true);
    view.setUint32(8, paddedLength, true);
  } else {
    view.setUint16(6, paddedLength, true);
  }

  out.set(valueBytes, headerSize);
  if (needsPad) {
    out[headerSize + valueBytes.length] = vr === 'UI' || isLongVr ? 0x00 : 0x20;
  }

  return out;
}

/**
 * 構造 uint16 (VR: US) 數值位元組
 */
function uint16Bytes(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, true);
  return buf;
}

/**
 * 構造最小合法未壓縮 2x2 8-bit MONOCHROME2 DICOM Part 10 二進位資料
 */
function buildMinimalDicomBytes(options: { numberOfFrames?: string } = {}): Uint8Array {
  const encoder = new TextEncoder();
  const preamble = new Uint8Array(128);
  const magic = encoder.encode('DICM');

  const elements: Uint8Array[] = [
    // (0002,0010) Transfer Syntax UID: Explicit VR Little Endian
    encodeDicomElement(0x0002, 0x0010, 'UI', encoder.encode('1.2.840.10008.1.2.1')),
    // (0028,0002) Samples per Pixel = 1
    encodeDicomElement(0x0028, 0x0002, 'US', uint16Bytes(1)),
    // (0028,0004) Photometric Interpretation = MONOCHROME2
    encodeDicomElement(0x0028, 0x0004, 'CS', encoder.encode('MONOCHROME2')),
  ];

  if (options.numberOfFrames !== undefined) {
    // (0028,0008) Number of Frames (VR: IS)
    elements.push(
      encodeDicomElement(0x0028, 0x0008, 'IS', encoder.encode(options.numberOfFrames))
    );
  }

  elements.push(
    // (0028,0010) Rows = 2
    encodeDicomElement(0x0028, 0x0010, 'US', uint16Bytes(2)),
    // (0028,0011) Columns = 2
    encodeDicomElement(0x0028, 0x0011, 'US', uint16Bytes(2)),
    // (0028,0100) Bits Allocated = 8
    encodeDicomElement(0x0028, 0x0100, 'US', uint16Bytes(8)),
    // (0028,0103) Pixel Representation = 0 (unsigned)
    encodeDicomElement(0x0028, 0x0103, 'US', uint16Bytes(0)),
    // (7FE0,0010) Pixel Data (2x2 灰階梯度)
    encodeDicomElement(0x7fe0, 0x0010, 'OB', new Uint8Array([0, 85, 170, 255]))
  );

  const totalLength =
    preamble.length +
    magic.length +
    elements.reduce((sum, el) => sum + el.length, 0);

  const result = new Uint8Array(totalLength);
  let offset = 0;
  result.set(preamble, offset);
  offset += preamble.length;
  result.set(magic, offset);
  offset += magic.length;

  for (const el of elements) {
    result.set(el, offset);
    offset += el.length;
  }

  return result;
}

/**
 * 執行包含 minimal document.createElement('canvas') mock 的非同步測試函式
 */
async function withMockCanvasDocument<T>(fn: () => Promise<T>): Promise<T> {
  const originalDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement(tagName: string) {
      if (tagName !== 'canvas') {
        throw new Error(`未預期的元素標籤: ${tagName}`);
      }
      return {
        width: 0,
        height: 0,
        getContext(contextId: string) {
          if (contextId !== '2d') return null;
          return {
            createImageData(width: number, height: number) {
              return {
                width,
                height,
                data: new Uint8ClampedArray(width * height * 4),
              };
            },
            putImageData() {
              // minimal mock: 不需實際繪製
            },
          };
        },
      };
    },
  };

  try {
    return await fn();
  } finally {
    if (originalDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = originalDocument;
    }
  }
}

describe('extractFrameCount', () => {
  it('應正確解析有效正整數的 Number of Frames (x00280008)', () => {
    const dataSet12 = dicomParser.parseDicom(
      buildMinimalDicomBytes({ numberOfFrames: '12' })
    );
    assert.equal(extractFrameCount(dataSet12), 12);

    const dataSet24 = dicomParser.parseDicom(
      buildMinimalDicomBytes({ numberOfFrames: ' 24 ' })
    );
    assert.equal(extractFrameCount(dataSet24), 24);
  });

  it('當 Number of Frames (x00280008) 不存在時應預設回傳 1', () => {
    const dataSet = dicomParser.parseDicom(buildMinimalDicomBytes());
    assert.equal(extractFrameCount(dataSet), 1);
  });

  it('當 Number of Frames 為空字串、純空白或非數字時應預設回傳 1', () => {
    const emptyDataSet = dicomParser.parseDicom(
      buildMinimalDicomBytes({ numberOfFrames: '' })
    );
    assert.equal(extractFrameCount(emptyDataSet), 1);

    const blankDataSet = dicomParser.parseDicom(
      buildMinimalDicomBytes({ numberOfFrames: '   ' })
    );
    assert.equal(extractFrameCount(blankDataSet), 1);

    const nonNumericDataSet = dicomParser.parseDicom(
      buildMinimalDicomBytes({ numberOfFrames: 'abc' })
    );
    assert.equal(extractFrameCount(nonNumericDataSet), 1);
  });

  it('當 Number of Frames 小於等於 0 時應預設回傳 1', () => {
    const zeroDataSet = dicomParser.parseDicom(
      buildMinimalDicomBytes({ numberOfFrames: '0' })
    );
    assert.equal(extractFrameCount(zeroDataSet), 1);

    const negativeDataSet = dicomParser.parseDicom(
      buildMinimalDicomBytes({ numberOfFrames: '-3' })
    );
    assert.equal(extractFrameCount(negativeDataSet), 1);
  });
});

describe('decodeDicomFirstFrame frameCount', () => {
  it('當 DICOM 包含 x00280008 (例如 5) 時，回傳結果應包含 frameCount: 5', async () => {
    const bytes = buildMinimalDicomBytes({ numberOfFrames: '5' });
    const fakeFile = {
      name: 'multi_frame.dcm',
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as File;

    const result = await withMockCanvasDocument(() => decodeDicomFirstFrame(fakeFile));
    assert.ok(result !== null);
    assert.equal(result.fileName, 'multi_frame.dcm');
    assert.equal(result.frameCount, 5);
  });

  it('當 DICOM 不包含 x00280008 時，回傳結果應預設包含 frameCount: 1', async () => {
    const bytes = buildMinimalDicomBytes();
    const fakeFile = {
      name: 'single_frame.dcm',
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as File;

    const result = await withMockCanvasDocument(() => decodeDicomFirstFrame(fakeFile));
    assert.ok(result !== null);
    assert.equal(result.fileName, 'single_frame.dcm');
    assert.equal(result.frameCount, 1);
  });
});
