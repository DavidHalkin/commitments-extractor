/**
 * PUT/POST a body with upload progress. `fetch` cannot report request-body progress,
 * so this uses XMLHttpRequest with the same URL, method and headers.
 * Network errors reject; HTTP errors resolve with `ok: false`.
 */
export function putWithProgress(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (fraction: number) => void,
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.send(body);
  });
}
