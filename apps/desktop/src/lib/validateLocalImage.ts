const acceptedImageTypes: Record<string, string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
};

interface ImageValidationOptions {
  minDimension?: number;
}

export async function validateLocalImage(file: File, { minDimension = 128 }: ImageValidationOptions = {}) {
  if (file.size === 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('Choose an image that is 10 MB or smaller.');
  }

  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!acceptedImageTypes[file.type]?.includes(extension ?? '')) {
    throw new Error('Choose a PNG, JPEG, or WebP image with a matching file type.');
  }

  const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const validSignature =
    file.type === 'image/png'
      ? signature.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte)
      : file.type === 'image/jpeg'
        ? signature.length >= 3 && signature[0] === 255 && signature[1] === 216 && signature[2] === 255
        : signature.length >= 12 &&
          String.fromCharCode(...signature.slice(0, 4)) === 'RIFF' &&
          String.fromCharCode(...signature.slice(8, 12)) === 'WEBP';
  if (!validSignature) throw new Error('The image data does not match its file type.');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image is damaged or cannot be decoded safely.');
  }
  const { width, height } = bitmap;
  bitmap.close();
  if (width < minDimension || height < minDimension || width > 4096 || height > 4096) {
    throw new Error(`Image dimensions must be between ${minDimension} × ${minDimension} and 4096 × 4096 pixels.`);
  }
}
