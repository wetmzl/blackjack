import fs from "node:fs";
import { chromium } from "playwright";

const [input, output, sourceXText, sourceYText, sourceWidthText, sourceHeightText, outputWidthText, outputHeightText] = process.argv.slice(2);
if (!input || !output || [sourceXText, sourceYText, sourceWidthText, sourceHeightText, outputWidthText, outputHeightText].some((value) => value == null)) {
  throw new Error("Usage: node tools/art/crop-resize-png.mjs <input.png> <output.png> <source-x> <source-y> <source-width> <source-height> <output-width> <output-height>");
}

const values = [sourceXText, sourceYText, sourceWidthText, sourceHeightText, outputWidthText, outputHeightText].map(Number);
if (values.some((value) => !Number.isInteger(value) || value < 0)) throw new Error("Crop and output values must be non-negative integers.");
const [sourceX, sourceY, sourceWidth, sourceHeight, outputWidth, outputHeight] = values;
if (sourceWidth === 0 || sourceHeight === 0 || outputWidth === 0 || outputHeight === 0) throw new Error("Crop and output dimensions must be greater than zero.");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  const source = `data:image/png;base64,${fs.readFileSync(input).toString("base64")}`;
  const result = await page.evaluate(async ({ imageSource, sourceX, sourceY, sourceWidth, sourceHeight, outputWidth, outputHeight }) => {
    const image = new Image();
    image.src = imageSource;
    await image.decode();
    if (sourceX + sourceWidth > image.width || sourceY + sourceHeight > image.height) {
      throw new Error(`Crop ${sourceX},${sourceY},${sourceWidth},${sourceHeight} exceeds ${image.width}x${image.height}.`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, outputWidth, outputHeight);
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
    return canvas.toDataURL("image/png");
  }, { imageSource: source, sourceX, sourceY, sourceWidth, sourceHeight, outputWidth, outputHeight });

  fs.writeFileSync(output, Buffer.from(result.split(",")[1], "base64"));
  process.stdout.write(`${output}: ${outputWidth}x${outputHeight} from ${sourceX},${sourceY},${sourceWidth},${sourceHeight}\n`);
} finally {
  await browser.close();
}
