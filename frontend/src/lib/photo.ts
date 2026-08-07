// 文件照片（InBody 報告等）壓縮成 data URL：報告上的數字細小，解析度要比餐點照片高
// （長邊 1100px、品質 0.8；後端會再壓進視覺模型的預算）
export function compressDocumentImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('無法解析圖片'));
      img.onload = () => {
        const maxSide = 1100;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// 照片壓縮 — 與原型 handlePhotoFile 相同規格：長邊 640px、JPEG 品質 0.7
export function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('無法解析圖片'));
      img.onload = () => {
        const maxSide = 640;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('壓縮失敗'))),
          'image/jpeg',
          0.7
        );
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
