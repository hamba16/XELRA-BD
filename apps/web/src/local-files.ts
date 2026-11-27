export interface StoredFile { id: string; name: string; type: string; size: number; sha256: string; blob: Blob; createdAt: number }
export interface FileStore { put(id: string, file: File): Promise<StoredFile>; get(id: string): Promise<StoredFile | null>; remove(id: string): Promise<void> }
export const localFileLimit = 20 * 1024 * 1024;
const types: Record<string, string[]> = {
  pdf: ["application/pdf"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  dwg: ["image/vnd.dwg", "application/acad"], dxf: ["image/vnd.dxf", "application/dxf", "text/plain"],
  jpg: ["image/jpeg"], jpeg: ["image/jpeg"], png: ["image/png"], webp: ["image/webp"], csv: ["text/csv", "application/vnd.ms-excel", "text/plain"], zip: ["application/zip", "application/x-zip-compressed"],
};
export async function fileDigest(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, "0")).join("");
}
export async function validateFile(file: File, maxBytes = localFileLimit): Promise<void> {
  const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
  if (!types[extension] || /[\x00-\x1f\\/]/.test(file.name) || file.name.length > 200) throw Error("Choose a supported document or image with a plain file name.");
  if (!file.size || file.size > maxBytes) throw Error(`Files must contain data and be at most ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  if (file.type && !types[extension].includes(file.type)) throw Error("The file type does not match its extension.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const signature = new TextDecoder().decode(bytes);
  if (extension === "pdf" && !signature.startsWith("%PDF-")) throw Error("The PDF signature is invalid.");
  if (["docx", "xlsx", "pptx", "zip"].includes(extension) && !(bytes[0] === 80 && bytes[1] === 75)) throw Error("The archive signature is invalid.");
  if (["jpg", "jpeg"].includes(extension) && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)) throw Error("The JPEG signature is invalid.");
  if (extension === "png" && !(bytes[0] === 137 && signature.slice(1, 4) === "PNG")) throw Error("The PNG signature is invalid.");
  if (extension === "webp" && !(signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP")) throw Error("The WebP signature is invalid.");
}
export class LocalFileStore implements FileStore {
  constructor(private owner: string) { if (!owner) throw Error("A profile is required for local files."); }
  private async run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`xelra-files-${this.owner}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(Error("Local file storage is unavailable. Keep the original file."));
    });
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("files", mode), request = action(transaction.objectStore("files"));
      transaction.oncomplete = () => { db.close(); resolve(request.result); };
      transaction.onabort = transaction.onerror = () => { db.close(); reject(Error("The file could not be saved. Device storage may be full; keep the original file.")); };
    });
  }
  async put(id: string, file: File): Promise<StoredFile> {
    await validateFile(file);
    const record: StoredFile = { id, name: file.name, type: file.type, size: file.size, sha256: await fileDigest(file), blob: file, createdAt: Date.now() };
    let conflict = false;
    try {
      await this.run("readwrite", store => {
        const request = store.get(id);
        request.onsuccess = () => {
          if (request.result && (request.result as StoredFile).sha256 !== record.sha256) { conflict = true; store.transaction.abort(); }
          else store.put(record);
        };
        return request;
      });
    } catch (e) {
      if (conflict) throw Error("This local file identifier has different content. The original was kept.");
      throw e;
    }
    const saved = await this.get(id);
    if (!saved || saved.sha256 !== record.sha256) throw Error("Local file verification failed. Keep the original file.");
    return saved;
  }
  async get(id: string): Promise<StoredFile | null> {
    const record = await this.run<StoredFile | undefined>("readonly", store => store.get(id));
    if (!record) return null;
    if (await fileDigest(record.blob) !== record.sha256) throw Error("The saved file failed its checksum check. Keep the original and contact support.");
    return record;
  }
  async remove(id: string): Promise<void> { await this.run("readwrite", store => store.delete(id)); }
}
export async function compressPhoto(file: File): Promise<File> {
  await validateFile(file);
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw Error("Choose a JPEG, PNG or WebP photo.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d"); if (!context) throw Error("This browser could not prepare the photo.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [0.72, 0.6, 0.48, 0.36]) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= 450 * 1024) break;
    }
    if (!blob || blob.size > 450 * 1024) throw Error("This photo is too detailed to save within the field-photo limit. Choose a smaller image.");
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
  } finally { bitmap.close(); }
}
export function downloadLocal(file: StoredFile): void {
  const url = URL.createObjectURL(file.blob), link = document.createElement("a");
  link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
