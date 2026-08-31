import fs from "node:fs";
import { chromium } from "playwright";

const pairs = process.argv.slice(2);
if (pairs.length === 0 || pairs.length % 2 !== 0) {
  throw new Error("Usage: node tools/art/remove-checkerboard.mjs <input.png> <output.png> [...]");
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
      const width = canvas.width;
      const height = canvas.height;
      const count = width * height;
      const background = new Uint8Array(count);
      const visited = new Uint8Array(count);
      const queue = new Int32Array(count);

      const resemblesCheckerboard = (pixelIndex) => {
        const offset = pixelIndex * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        return Math.min(red, green, blue) >= 222 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 24;
      };
      for (let start = 0; start < count; start += 1) {
        if (visited[start] || !resemblesCheckerboard(start)) continue;
        let head = 0;
        let tail = 0;
        let neutralPixels = 0;
        let touchesCanvasEdge = false;
        visited[start] = 1;
        queue[tail++] = start;
        while (head < tail) {
          const pixelIndex = queue[head++];
          const x = pixelIndex % width;
          const y = Math.floor(pixelIndex / width);
          const offset = pixelIndex * 4;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          if (Math.max(red, green, blue) - Math.min(red, green, blue) <= 3) neutralPixels += 1;
          if (x === 0 || x + 1 === width || y === 0 || y + 1 === height) touchesCanvasEdge = true;
          const neighbours = [x > 0 ? pixelIndex - 1 : -1, x + 1 < width ? pixelIndex + 1 : -1, y > 0 ? pixelIndex - width : -1, y + 1 < height ? pixelIndex + width : -1];
          for (const neighbour of neighbours) {
            if (neighbour >= 0 && !visited[neighbour] && resemblesCheckerboard(neighbour)) {
              visited[neighbour] = 1;
              queue[tail++] = neighbour;
            }
          }
        }
        const isEnclosedCheckerPatch = tail >= 128 && neutralPixels / tail >= 0.95;
        if (touchesCanvasEdge || isEnclosedCheckerPatch) {
          for (let componentIndex = 0; componentIndex < tail; componentIndex += 1) background[queue[componentIndex]] = 1;
        }
      }

      const edgeDistance = new Uint8Array(count);
      for (let pixelIndex = 0; pixelIndex < count; pixelIndex += 1) {
        if (background[pixelIndex]) pixels[pixelIndex * 4 + 3] = 0;
      }
      for (let pixelIndex = 0; pixelIndex < count; pixelIndex += 1) {
        if (background[pixelIndex]) continue;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        const touchesBackground = (x > 0 && background[pixelIndex - 1])
          || (x + 1 < width && background[pixelIndex + 1])
          || (y > 0 && background[pixelIndex - width])
          || (y + 1 < height && background[pixelIndex + width]);
        if (touchesBackground) edgeDistance[pixelIndex] = 1;
      }
      for (let pixelIndex = 0; pixelIndex < count; pixelIndex += 1) {
        if (edgeDistance[pixelIndex] !== 1) continue;
        const offset = pixelIndex * 4;
        const alpha = 210 / 255;
        for (let channel = 0; channel < 3; channel += 1) {
          pixels[offset + channel] = Math.max(0, Math.min(255, Math.round((pixels[offset + channel] - (1 - alpha) * 249) / alpha)));
        }
        pixels[offset + 3] = 210;
      }
      context.putImageData(imageData, 0, 0);
      return {
        dataUrl: canvas.toDataURL("image/png"),
        stats: { width, height, transparent: background.reduce((sum, value) => sum + value, 0), total: count }
      };
    }, source);
    fs.writeFileSync(output, Buffer.from(result.dataUrl.split(",")[1], "base64"));
    process.stdout.write(`${output}: ${JSON.stringify(result.stats)}\n`);
  }
} finally {
  await browser.close();
}
