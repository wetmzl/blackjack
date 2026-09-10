import { SaveValidationError, validateLongTermSave, type LongTermSave } from "./schema";

export function exportSaveJson(save: LongTermSave): string {
  return JSON.stringify(validateLongTermSave(save), null, 2);
}

export async function importSave(input: string | File): Promise<LongTermSave> {
  const text = typeof input === "string" ? input : await input.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch { throw new SaveValidationError("long-term", "Invalid save JSON: unable to parse file", text); }
  return validateLongTermSave(parsed);
}

interface FileSystemWritable { write(data: string): Promise<void>; close(): Promise<void>; }
interface FileSystemSaveHandle { createWritable(): Promise<FileSystemWritable>; }
interface FileSystemOpenHandle { getFile(): Promise<File>; }
interface FileSystemWindow {
  showSaveFilePicker?: (options?: unknown) => Promise<FileSystemSaveHandle>;
  showOpenFilePicker?: (options?: unknown) => Promise<readonly FileSystemOpenHandle[]>;
}

export type SaveExportMethod = "file-system-access" | "blob-download";

export async function downloadSave(save: LongTermSave, filename = "house-of-chances-save.json"): Promise<SaveExportMethod> {
  return downloadJson(exportSaveJson(save), filename);
}

export async function downloadRawSave(input: unknown, filename = "house-of-chances-unmigrated-save.json"): Promise<SaveExportMethod> {
  const text = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  if (text === undefined) throw new Error("No original save data is available to export");
  return downloadJson(text, filename);
}

async function downloadJson(json: string, filename: string): Promise<SaveExportMethod> {
  const host = globalThis as unknown as FileSystemWindow;
  if (host.showSaveFilePicker) {
    const handle = await host.showSaveFilePicker({ suggestedName: filename, types: [{ description: "JSON save", accept: { "application/json": [".json"] } }] });
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return "file-system-access";
  }
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally { URL.revokeObjectURL(url); }
  return "blob-download";
}

export async function openSaveWithFileSystemAccess(): Promise<LongTermSave> {
  const host = globalThis as unknown as FileSystemWindow;
  if (!host.showOpenFilePicker) throw new Error("File System Access API is unavailable; choose a save file instead");
  const handles = await host.showOpenFilePicker({ multiple: false, types: [{ description: "JSON save", accept: { "application/json": [".json"] } }] });
  if (handles.length === 0) throw new Error("No save file selected");
  return importSave(await handles[0].getFile());
}
