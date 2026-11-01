/**
 * A browser download is the same six steps everywhere: build a Blob, mint an
 * object URL, click an anchor, then release the URL after the click has been
 * handled. Keeping the steps in one place means an export cannot forget the
 * release and leak the file for the life of the tab.
 */
export function downloadFile(filename: string, content: string, type: string): Blob {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Safari reads the URL after the click handler returns, so releasing it in
  // the same tick can cancel the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return blob;
}
