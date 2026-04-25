import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export type ImageSize =
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "512x512"
  | "256x256"
  | "auto";

export async function generateImageBuffer(
  prompt: string,
  size: ImageSize = "1024x1024",
): Promise<Buffer> {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size,
  });
  const base64 = response.data?.[0]?.b64_json ?? "";
  if (!base64) {
    throw new Error("OpenAI image generation returned no image data.");
  }
  return Buffer.from(base64, "base64");
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string,
  size: ImageSize = "1024x1024",
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      }),
    ),
  );

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: images,
    prompt,
    size,
  });

  const imageBase64 = response.data?.[0]?.b64_json ?? "";
  if (!imageBase64) {
    throw new Error("OpenAI image edit returned no image data.");
  }
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}

export interface BufferImageInput {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
}

export async function editImagesFromBuffers(
  inputs: BufferImageInput[],
  prompt: string,
  size: ImageSize = "1024x1024",
): Promise<Buffer> {
  const images = await Promise.all(
    inputs.map((input) =>
      toFile(input.buffer, input.filename, {
        type: input.mimeType ?? "image/png",
      }),
    ),
  );

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: images,
    prompt,
    size,
  });

  const imageBase64 = response.data?.[0]?.b64_json ?? "";
  if (!imageBase64) {
    throw new Error("OpenAI image edit returned no image data.");
  }
  return Buffer.from(imageBase64, "base64");
}
