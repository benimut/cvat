import { decodeDicomFirstFrame } from './dicomDecoder.ts';

/**
 * 將檔案名稱與幀數格式化為「檔名(幀數)」顯示字串
 * @param fileName - DICOM 檔案名稱
 * @param frameCount - 影像總幀數
 * @returns 格式化後的顯示字串
 */
export function formatFileNameWithFrameCount(fileName: string, frameCount: number): string {
  return `${fileName}(${frameCount})`;
}

/**
 * 渲染極簡 DICOM 第一幀檢視器介面（僅記憶體操作，無任何本地儲存）
 */
function initApp(): void {
  const root = document.getElementById('app');
  if (!root) return;

  // 頂部工具列：淺藍與舒適白配色，僅保留選擇資料夾按鈕
  const header = document.createElement('header');
  header.className = 'sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-sky-100 px-6 py-4 flex items-center justify-between';

  const selectLabel = document.createElement('label');
  selectLabel.className =
    'inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white text-sm font-medium shadow-xs cursor-pointer transition-colors';
  selectLabel.textContent = '選擇資料夾';

  const folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.multiple = true;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.setAttribute('directory', '');
  folderInput.className = 'hidden';
  selectLabel.appendChild(folderInput);

  const countBadge = document.createElement('span');
  countBadge.className = 'text-sm font-medium text-sky-700 bg-sky-50 border border-sky-200 px-3 py-1 rounded-full hidden';

  header.appendChild(selectLabel);
  header.appendChild(countBadge);

  // 主要內容區域：顯示檔名與第一幀預覽圖網格
  const main = document.createElement('main');
  main.className = 'flex-1 p-6';

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4';
  main.appendChild(grid);

  root.appendChild(header);
  root.appendChild(main);

  /**
   * 清除畫布與 DOM 節點，確保記憶體不殘留
   */
  const clearGrid = (): void => {
    const canvases = grid.querySelectorAll('canvas');
    canvases.forEach((c) => {
      c.width = 0;
      c.height = 0;
    });
    grid.replaceChildren();
    countBadge.classList.add('hidden');
    countBadge.textContent = '';
  };

  folderInput.addEventListener('change', async () => {
    const fileList = folderInput.files;
    if (!fileList || fileList.length === 0) return;

    clearGrid();

    // 依檔名排序以保持一致瀏覽順序
    const files = Array.from(fileList).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );

    let loadedCount = 0;
    for (const file of files) {
      try {
        const result = await decodeDicomFirstFrame(file);
        if (!result) continue;

        const card = document.createElement('div');
        card.className =
          'bg-white border border-sky-100 rounded-xl overflow-hidden shadow-xs flex flex-col';

        const frameBox = document.createElement('div');
        frameBox.className = 'aspect-4/3 bg-sky-50/50 flex items-center justify-center overflow-hidden';

        result.canvas.className = 'max-w-full max-h-full object-contain';
        frameBox.appendChild(result.canvas);

        const nameBar = document.createElement('div');
        nameBar.className =
          'px-3 py-2 border-t border-sky-100 bg-white text-xs font-medium text-slate-700 truncate';
        const formattedName = formatFileNameWithFrameCount(result.fileName, result.frameCount);
        nameBar.title = formattedName;
        nameBar.textContent = formattedName;

        card.appendChild(frameBox);
        card.appendChild(nameBar);
        grid.appendChild(card);

        loadedCount++;
        countBadge.textContent = `${loadedCount}`;
        countBadge.classList.remove('hidden');
      } catch {
        // 單一檔案解碼失敗不中斷其餘檔案載入
      }
    }

    // 清空 input 值以便使用者可重複選取同一資料夾
    folderInput.value = '';
  });

  // 關閉或離開網頁前清除記憶體中的畫布資源
  window.addEventListener('beforeunload', clearGrid);
}

if (typeof document !== 'undefined') {
  initApp();
}
