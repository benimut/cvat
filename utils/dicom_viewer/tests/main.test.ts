import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatFileNameWithFrameCount } from '../src/main.ts';

describe('formatFileNameWithFrameCount', () => {
  it('應在多幀 DICOM 檔名後方加上 (N) 格式', () => {
    // 驗證常見多幀 DICOM 檔名格式化結果
    assert.equal(formatFileNameWithFrameCount('scan.dcm', 15), 'scan.dcm(15)');
  });

  it('應在單幀 DICOM 檔名後方加上 (1) 格式', () => {
    // 驗證單幀 DICOM 檔名同樣顯示 (1)
    assert.equal(formatFileNameWithFrameCount('single.dcm', 1), 'single.dcm(1)');
  });

  it('應支援無副檔名的檔名格式', () => {
    // 驗證沒有副檔名時仍正確附加 (N)
    assert.equal(formatFileNameWithFrameCount('IM_0001', 42), 'IM_0001(42)');
  });

  it('應支援包含空白或特殊字元的檔名與較大幀數', () => {
    // 驗證含空白檔名與多位數幀數不會被截斷或修改
    assert.equal(
      formatFileNameWithFrameCount('patient 01_ct.dcm', 1024),
      'patient 01_ct.dcm(1024)'
    );
  });

  it('應正確處理幀數為 0 的邊界情況', () => {
    // 驗證幀數為 0 時仍依照 ${fileName}(${frameCount}) 規格輸出
    assert.equal(formatFileNameWithFrameCount('empty.dcm', 0), 'empty.dcm(0)');
  });
});
