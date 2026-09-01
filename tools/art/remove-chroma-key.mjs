import fs from "node:fs";
import { chromium } from "playwright";

const pairs = process.argv.slice(2);
if (pairs.length === 0 || pairs.length % 2 !== 0) {
  throw new Error("Usage: node tools/art/remove-chroma-key.mjs <input.png> <output.png> [...]");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  for (let index = 0; index < pairs.length; index += 2) {
    const input = pairs[index];
    const output = pairs[index + 1];
    const source = `data:image/png;base64,${fs.readFileSync(input).toString("base64")}`;
    const result = await page.evaluate(async (imageSource) => {
      const image = new Image();
      image.src = imageSource;
      await image.decode();

      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D context unavailable");
      context.drawImage(image, 0, 0);

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      const original = new Uint8ClampedArray(pixels);

      for (let offset = 0; offset < pixels.length; offset += 4) {
        const red = original[offset];
        const green = original[offset + 1];
        const blue = original[offset + 2];
        const greenExcess = green - Math.max(red, blue);

        // The generated intermediate uses a saturated green screen. Muted jade
        // costume details remain well below these brightness/excess thresholds.
        let alpha = 255;
        if (green >= 180 && greenExcess >= 90) alpha = 0;
        else if (green >= 130 && greenExcess >= 42) {
          alpha = Math.round(255 * (1 - (greenExcess - 42) / 48));
          alpha = Math.max(0, Math.min(255, alpha));
        }

        if (alpha === 0) {
          pixels[offset + 3] = 0;
        } else {
          pixels[offset + 3] = alpha;
        }
      }

      // Refine only pixels beside the removed screen. This catches green spill
      // on pale hair and clothing without keying the jade bracelet internally.
      const width = canvas.width;
      const height = canvas.height;
      const refinedAlpha = new Uint8ClampedArray(width * height);
      for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
        const offset = pixelIndex * 4;
        let alpha = pixels[offset + 3];
        if (alpha === 0) continue;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        let nearTransparent = false;
        for (let dy = -2; dy <= 2 && !nearTransparent; dy += 1) {
          const neighbourY = y + dy;
          if (neighbourY < 0 || neighbourY >= height) continue;
          for (let dx = -2; dx <= 2; dx += 1) {
            const neighbourX = x + dx;
            if (neighbourX < 0 || neighbourX >= width) continue;
            if (pixels[(neighbourY * width + neighbourX) * 4 + 3] === 0) {
              nearTransparent = true;
              break;
            }
          }
        }
        if (nearTransparent) {
          const red = original[offset];
          const green = original[offset + 1];
          const blue = original[offset + 2];
          const greenExcess = green - Math.max(red, blue);
          if (green >= 130 && greenExcess > 20) {
            const estimatedAlpha = Math.round(255 * (1 - (greenExcess - 20) / 235));
            alpha = Math.min(alpha, Math.max(0, estimatedAlpha));
          }
        }
        refinedAlpha[pixelIndex] = alpha;
      }

      let transparent = 0;
      let partial = 0;
      let opaque = 0;
      for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
        const offset = pixelIndex * 4;
        const alpha = refinedAlpha[pixelIndex];
        if (alpha === 0) {
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
          pixels[offset + 3] = 0;
          transparent += 1;
          continue;
        }
        if (alpha < 255) {
          pixels[offset] = original[offset];
          pixels[offset + 1] = Math.min(original[offset + 1], Math.max(original[offset], original[offset + 2]));
          pixels[offset + 2] = original[offset + 2];
          pixels[offset + 3] = alpha;
          partial += 1;
        } else {
          pixels[offset] = original[offset];
          pixels[offset + 1] = original[offset + 1];
          pixels[offset + 2] = original[offset + 2];
          pixels[offset + 3] = 255;
          opaque += 1;
        }
      }

      context.putImageData(imageData, 0, 0);
      return {
        dataUrl: canvas.toDataURL("image/png"),
        stats: { width: canvas.width, height: canvas.height, transparent, partial, opaque }
      };
    }, source);

    fs.writeFileSync(output, Buffer.from(result.dataUrl.split(",")[1], "base64"));
    process.stdout.write(`${output}: ${JSON.stringify(result.stats)}\n`);
  }
} finally {
  await browser.close();
}
