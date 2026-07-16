import { put } from '@vercel/blob';

const TEMP_PREFIX = 'tmp';

export async function putTempBlob(path, buffer, contentType = 'image/png') {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return {
      url: `data:${contentType};base64,${buffer.toString('base64')}`,
      pathname: path,
      temporary: true,
    };
  }
  const pathname = `${TEMP_PREFIX}/${path}`;
  const blob = await put(pathname, buffer, {
    access: 'public',
    contentType,
    token,
  });
  return { url: blob.url, pathname: blob.pathname, temporary: true };
}

export async function putTempImage(jobId, name, buffer, contentType = 'image/png') {
  return putTempBlob(`${jobId}/${name}`, buffer, contentType);
}

export function encodeGenerationResponse(result) {
  return {
    imageBase64: result.buffer.toString('base64'),
    mime: result.mime,
    ext: result.ext,
  };
}
