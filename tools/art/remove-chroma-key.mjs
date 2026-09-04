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
        // Image generators sometimes paint cast shadows directly onto the
        // screen, turning #00ff00 into a much darker but still nearly pure
        // green. Key that family out as well; requiring a large distance from
        // both red and blue preserves cyan/jade costume accents.
        if (
          (green >= 180 && greenExcess >= 90) ||
          (green >= 48 && green - red >= 40 && green - blue >= 42)
        ) alpha = 0;
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

      // Measure a short distance from the removed screen. Green spill can reach
      // several antialiased pixels into pale hair, while interior jade costume
      // details remain outside this narrow edge band.
      const width = canvas.width;
      const height = canvas.height;
      const count = width * height;
      const distance = new Uint8Array(count);
      const queue = new Int32Array(count);
      let queueHead = 0;
      let queueTail = 0;
      for (let pixelIndex = 0; pixelIndex < count; pixelIndex += 1) {
        const offset = pixelIndex * 4;
        if (pixels[offset + 3] === 0) {
          distance[pixelIndex] = 1;
          queue[queueTail++] = pixelIndex;
        }
      }
      while (queueHead < queueTail) {
        const pixelIndex = queue[queueHead++];
        const currentDistance = distance[pixelIndex];
        if (currentDistance >= 7) continue;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        const neighbours = [
          x > 0 ? pixelIndex - 1 : -1,
          x + 1 < width ? pixelIndex + 1 : -1,
          y > 0 ? pixelIndex - width : -1,
          y + 1 < height ? pixelIndex + width : -1
        ];
        for (const neighbour of neighbours) {
          if (neighbour >= 0 && distance[neighbour] === 0) {
            distance[neighbour] = currentDistance + 1;
            queue[queueTail++] = neighbour;
          }
        }
      }

      for (let pixelIndex = 0; pixelIndex < count; pixelIndex += 1) {
        const offset = pixelIndex * 4;
        let alpha = pixels[offset + 3];
        if (alpha > 0 && distance[pixelIndex] > 1 && distance[pixelIndex] <= 7) {
          const red = original[offset];
          const green = original[offset + 1];
          const blue = original[offset + 2];
          const greenExcess = green - Math.max(red, blue);
          if (greenExcess > 4 && green > red * 1.04 && green > blue * 1.04) {
            alpha = Math.max(0, Math.min(alpha, 255 - greenExcess));
          }
        }
        if (alpha <= 6) {
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
          pixels[offset + 3] = 0;
        } else if (alpha < 255) {
          const ratio = alpha / 255;
          pixels[offset] = Math.max(0, Math.min(255, Math.round(original[offset] / ratio)));
          pixels[offset + 1] = Math.max(0, Math.min(255, Math.round((original[offset + 1] - (1 - ratio) * 255) / ratio)));
          pixels[offset + 2] = Math.max(0, Math.min(255, Math.round(original[offset + 2] / ratio)));
          pixels[offset + 3] = alpha;
        } else {
          pixels[offset] = original[offset];
          pixels[offset + 1] = original[offset + 1];
          pixels[offset + 2] = original[offset + 2];
          pixels[offset + 3] = 255;
        }
      }

      let transparent = 0;
      let partial = 0;
      let opaque = 0;
      for (let offset = 3; offset < pixels.length; offset += 4) {
        if (pixels[offset] === 0) transparent += 1;
        else if (pixels[offset] < 255) partial += 1;
        else opaque += 1;
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
