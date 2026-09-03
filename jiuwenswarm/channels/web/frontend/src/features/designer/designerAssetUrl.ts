/** Turn a Designer output_ref.uri into a browser-playable /file-api URL. */

export function fileUriToLocalPath(uri: string): string | null {
  const value = (uri || '').trim();
  if (!value) return null;
  if (value.startsWith('designer://')) return null;
  if (/^https?:\/\//i.test(value)) return null;
  if (value.startsWith('file:')) {
    try {
      const parsed = new URL(value);
      let pathname = decodeURIComponent(parsed.pathname);
      if (/^\/[A-Za-z]:\//.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return pathname;
    } catch {
      return null;
    }
  }
  return value;
}

export function isPlaceholderAsset(uri: string | null | undefined): boolean {
  return Boolean(uri?.startsWith('designer://'));
}

export function designerAssetPreviewUrl(uri: string | null | undefined): string | null {
  const value = (uri || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const localPath = fileUriToLocalPath(value);
  if (!localPath) return null;
  return `/file-api/raw-file?path=${encodeURIComponent(localPath)}`;
}

export function designerAssetTextUrl(uri: string | null | undefined): string | null {
  const value = (uri || '').trim();
  if (!value || /^https?:\/\//i.test(value)) return null;
  const localPath = fileUriToLocalPath(value);
  if (!localPath) return null;
  return `/file-api/file-content?path=${encodeURIComponent(localPath)}&encoding=auto`;
}
