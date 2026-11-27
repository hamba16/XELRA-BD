import type { Job } from "../../../packages/lab/src/lib/offline-queue";
import { fileDigest, type StoredFile } from "./local-files";
export interface FileTransport {
  upload(file: StoredFile): Promise<{ key: string; sha256: string }>;
}
export interface FieldPayload {
  p_client: string; p_project: string; p_body: { note: string }; p_captured: string;
  local_photos?: StoredFile[];
}
export async function sendFieldJob(job: Job, transport: FileTransport | null, rpc: (args: Record<string, unknown>) => Promise<unknown>): Promise<"created" | "duplicate"> {
  const payload = job.payload as FieldPayload;
  const { local_photos: photos = [], ...args } = payload;
  if (photos.length && !transport) throw Error("Photo delivery is unavailable. Your report and photos are still saved on this device.");
  const attachments: { key: string; sha256: string; name: string; size: number }[] = [];
  for (const photo of photos) {
    if (await fileDigest(photo.blob) !== photo.sha256) throw Error("A saved photo failed its checksum check. The report was kept on this device.");
    const receipt = await transport!.upload(photo);
    if (!receipt.key || receipt.sha256 !== photo.sha256) throw Error("Photo delivery was not verified. The report was kept on this device.");
    attachments.push({ ...receipt, name: photo.name, size: photo.size });
  }
  const result = await rpc({ ...args, p_body: photos.length ? { ...args.p_body, attachments } : args.p_body });
  if (result !== "created" && result !== "duplicate") throw Error("The server did not confirm this report.");
  return result;
}
