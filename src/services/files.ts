// Сохранение / отправка файлов: на устройстве — через Filesystem + Share, в браузере — скачивание.

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export async function saveFile(name: string, data: string | Blob, mime = 'application/octet-stream'): Promise<void> {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  if (Capacitor.isNativePlatform()) {
    const res = await Filesystem.writeFile({ path: name, data: await blobToBase64(blob), directory: Directory.Cache });
    await Share.share({ title: name, url: res.uri, dialogTitle: name });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Выбор файла пользователем (в WebView открывает системный диалог). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
