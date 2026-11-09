import { readBackupText } from './pack';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 读备份文件，.json 和 .json.gz 都行 */
export async function readJsonFile(file: File): Promise<unknown> {
  const text = await readBackupText(file);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${file.name} 不是有效的 JSON 文件`);
  }
}
