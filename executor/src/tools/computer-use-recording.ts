export function assertRecordingSandbox(
  recording: { sandboxId?: string },
  sandboxId: string
): void {
  if (recording.sandboxId !== sandboxId) {
    throw new Error("This case recording belongs to another or an unknown E2B sandbox");
  }
}
