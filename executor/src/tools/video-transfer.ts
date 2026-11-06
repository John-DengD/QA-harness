import { createHash, randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";

export async function saveVerifiedVideoStream(
  stream: ReadableStream<Uint8Array>,
  outputPath: string,
  expectedSize: number,
  expectedSha256: string
): Promise<number> {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1) {
    throw new Error("The finalized case video is empty or has an invalid size");
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("The remote case video checksum is invalid");
  }

  const partialPath = `${outputPath}.partial-${randomUUID()}`;
  const file = await open(partialPath, "wx", 0o600);
  const reader = stream.getReader();
  const hash = createHash("sha256");
  let bytesWritten = 0;
  let verified = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesWritten += value.byteLength;
      if (bytesWritten > expectedSize) {
        throw new Error("The case video stream exceeds the remote file size");
      }
      hash.update(value);
      await file.writeFile(value);
    }
    if (bytesWritten !== expectedSize) {
      throw new Error(`The case video stream is incomplete (${bytesWritten}/${expectedSize} bytes)`);
    }
    if (hash.digest("hex") !== expectedSha256) {
      throw new Error("The case video stream checksum does not match the remote file");
    }
    await file.sync();
    verified = true;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
    await file.close();
    if (!verified) await unlink(partialPath).catch(() => {});
  }

  try {
    await rename(partialPath, outputPath);
  } catch (error) {
    await unlink(partialPath).catch(() => {});
    throw error;
  }
  return bytesWritten;
}
