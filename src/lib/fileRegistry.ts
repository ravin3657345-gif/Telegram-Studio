// Tracks File objects by UUID so TipTap nodes can reference them at publish time.
// Blob URLs live in node attrs; this maps those IDs back to the actual File.

const registry = new Map<string, File>();
const blobUrls  = new Map<string, string>();

export const fileRegistry = {
  add(file: File): { id: string; src: string } {
    const id  = crypto.randomUUID();
    const src = URL.createObjectURL(file);
    registry.set(id, file);
    blobUrls.set(id, src);
    return { id, src };
  },

  getFile(id: string): File | undefined {
    return registry.get(id);
  },

  /** Register a pre-existing file with a known ID (used when restoring draft attachments). */
  addWithId(id: string, file: File): string {
    const src = URL.createObjectURL(file);
    registry.set(id, file);
    blobUrls.set(id, src);
    return src;
  },

  remove(id: string): void {
    const src = blobUrls.get(id);
    if (src) URL.revokeObjectURL(src);
    registry.delete(id);
    blobUrls.delete(id);
  },

  clear(): void {
    blobUrls.forEach((src) => URL.revokeObjectURL(src));
    registry.clear();
    blobUrls.clear();
  },
};
