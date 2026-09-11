export function warnLocalExecution(writer: {
  write(text: string): unknown;
}): void {
  writer.write(
    "Warning: local execution gives tools host access and may load personal configuration, skills, and credentials.\n",
  );
}
