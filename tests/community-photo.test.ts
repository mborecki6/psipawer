import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prepareCommunityPhoto } from "../src/lib/community-photo";

describe("public community photos", () => {
  it("strips source metadata and preserves the displayed orientation", async () => {
    const source = await sharp({
      create: { width: 100, height: 60, channels: 3, background: "#deba92" },
    })
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD0: { Artist: "Private source owner", Copyright: "Private metadata" },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const output = await prepareCommunityPhoto(source);
    const info = await sharp(output).metadata();
    expect(info.format).toBe("webp");
    expect([info.width, info.height]).toEqual([60, 100]);
    expect(info.exif).toBeUndefined();
    expect(info.xmp).toBeUndefined();
    expect(info.orientation).toBeUndefined();
  });
  it("bounds output size without upscaling small images", async () => {
    const source = await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: "#eee" },
    })
      .png()
      .toBuffer();
    const info = await sharp(await prepareCommunityPhoto(source)).metadata();
    expect([info.width, info.height]).toEqual([1200, 600]);
  });
  it("rejects corrupt, unsupported, oversized, and excessively large decoded images", async () => {
    await expect(
      prepareCommunityPhoto(new TextEncoder().encode("<svg></svg>")),
    ).rejects.toThrow("JPG");
    await expect(
      prepareCommunityPhoto(new Uint8Array([255, 216, 255, 0])),
    ).rejects.toThrow("odczytać");
    await expect(
      prepareCommunityPhoto(new Uint8Array(1_500_001)),
    ).rejects.toThrow("1,5 MB");
    const excessive = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: "#eee" },
    })
      .png()
      .toBuffer();
    await expect(prepareCommunityPhoto(excessive)).rejects.toThrow(
      "16 megapikseli",
    );
  });
});
