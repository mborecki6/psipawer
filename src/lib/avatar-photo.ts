import sharp from "sharp";

sharp.concurrency(2);

export async function prepareAvatarPhoto(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 1_500_000)
    throw new Error("Wybierz zdjęcie do 1,5 MB.");
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  const webp =
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (!jpeg && !png && !webp)
    throw new Error("Wybierz zdjęcie JPG, PNG lub WebP.");
  try {
    // Decode both public and private photos; strip metadata while preserving
    // visual orientation, and avoid passing corrupt files to Storage.
    return await sharp(bytes, {
      limitInputPixels: 16_000_000,
      failOn: "warning",
    })
      .autoOrient()
      .resize({
        width: 1200,
        height: 1200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 3 })
      .timeout({ seconds: 10 })
      .toBuffer();
  } catch {
    throw new Error(
      "Nie można odczytać zdjęcia. Wybierz poprawny JPG, PNG lub WebP do 16 megapikseli.",
    );
  }
}
