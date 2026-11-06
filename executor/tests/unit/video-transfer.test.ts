import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { saveVerifiedVideoStream } from "../../src/tools/video-transfer";

const temporaryDirectories: string[] = [];

async function caseDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qa-video-transfer-"));
  temporaryDirectories.push(directory);
  return directory;
}

function chunks(...parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("case video transfer", () => {
  it("streams multiple chunks to one complete and private video", async () => {
    const directory = await caseDirectory();
    const outputPath = path.join(directory, "video.webm");
    const original = Buffer.alloc(9 * 1024 * 1024 + 7);
    for (let index = 0; index < original.length; index++) {
      original[index] = index % 251;
    }
    const parts: Uint8Array[] = [];
    for (let offset = 0; offset < original.length; offset += 256 * 1024) {
      parts.push(original.subarray(offset, offset + 256 * 1024));
    }

    const bytes = await saveVerifiedVideoStream(
      chunks(...parts),
      outputPath,
      original.byteLength,
      sha256(original)
    );

    expect(bytes).toBe(original.byteLength);
    expect(sha256(await readFile(outputPath))).toBe(sha256(original));
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(["video.webm"]);
  });

  it("rejects a truncated stream without finalizing and permits retry", async () => {
    const directory = await caseDirectory();
    const outputPath = path.join(directory, "video.webm");
    const original = Buffer.from("full case video, including the final segment");
    const partial = original.subarray(0, 10);

    await expect(
      saveVerifiedVideoStream(chunks(partial), outputPath, original.length, sha256(original))
    ).rejects.toThrow(/incomplete/);
    expect(await readdir(directory)).toEqual([]);

    await expect(
      saveVerifiedVideoStream(chunks(original), outputPath, original.length, sha256(original))
    ).resolves.toBe(original.length);
    expect(await readFile(outputPath)).toEqual(original);
  });

  it("rejects a same-size corrupted stream and an oversized stream", async () => {
    const directory = await caseDirectory();
    const outputPath = path.join(directory, "video.webm");
    const expected = Buffer.from("original-video");

    await expect(
      saveVerifiedVideoStream(
        chunks(Buffer.from("tampered-video")), outputPath, expected.length, sha256(expected)
      )
    ).rejects.toThrow(/checksum/);
    await expect(
      saveVerifiedVideoStream(
        chunks(Buffer.from("original-video-too-long")), outputPath, expected.length, sha256(expected)
      )
    ).rejects.toThrow(/exceeds/);
    expect(await readdir(directory)).toEqual([]);
  });

  it("does not finalize when the remote stream fails midway", async () => {
    const directory = await caseDirectory();
    const outputPath = path.join(directory, "video.webm");
    const original = Buffer.from("two segments of a video");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(original.subarray(0, 10));
        controller.error(new Error("remote stream interrupted"));
      },
    });

    await expect(
      saveVerifiedVideoStream(stream, outputPath, original.length, sha256(original))
    ).rejects.toThrow(/remote stream interrupted/);
    expect(await readdir(directory)).toEqual([]);
  });
});
