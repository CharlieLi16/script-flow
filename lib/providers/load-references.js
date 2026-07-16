export async function loadReferences(referenceData = []) {
  if (!referenceData?.length) return [];
  const refs = [];
  for (const ref of referenceData) {
    if (ref.base64) {
      refs.push({
        buffer: Buffer.from(ref.base64, 'base64'),
        mime: ref.mime || 'image/png',
      });
    } else if (ref.url) {
      const res = await fetch(ref.url);
      if (!res.ok) throw new Error(`Failed to load reference: ${ref.url}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get('content-type') || 'image/png';
      refs.push({ buffer, mime });
    }
  }
  return refs;
}

export function referencesFromUrls(urls, baseUrl) {
  return (urls || []).map((url) => ({
    url: url.startsWith('http') ? url : `${baseUrl}${url}`,
  }));
}
