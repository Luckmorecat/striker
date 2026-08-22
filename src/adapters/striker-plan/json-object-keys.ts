export function rejectDuplicateJsonKeys(source: string): void {
  new JsonObjectKeyScanner(source).scan();
}

class JsonObjectKeyScanner {
  #index = 0;

  constructor(private readonly source: string) {}

  scan(): void {
    this.scanValue([]);
  }

  private scanValue(path: readonly string[]): void {
    this.skipWhitespace();
    const token = this.source[this.#index];
    if (token === "{") {
      this.scanObject(path);
    } else if (token === "[") {
      this.scanArray(path);
    } else if (token === '"') {
      this.readString();
    } else {
      this.scanPrimitive();
    }
  }

  private scanObject(path: readonly string[]): void {
    this.#index += 1;
    this.skipWhitespace();
    if (this.consume("}")) return;
    const keys = new Set<string>();
    while (this.#index < this.source.length) {
      this.skipWhitespace();
      const key = this.readString();
      const keyPath = [...path, key];
      if (keys.has(key)) {
        throw new Error(`duplicate JSON object key: ${keyPath.join(".")}`);
      }
      keys.add(key);
      this.skipWhitespace();
      this.expect(":");
      this.scanValue(keyPath);
      this.skipWhitespace();
      if (this.consume("}")) return;
      this.expect(",");
    }
    throw new Error("unterminated JSON object");
  }

  private scanArray(path: readonly string[]): void {
    this.#index += 1;
    this.skipWhitespace();
    if (this.consume("]")) return;
    let item = 0;
    while (this.#index < this.source.length) {
      this.scanValue([...path, `[${String(item)}]`]);
      item += 1;
      this.skipWhitespace();
      if (this.consume("]")) return;
      this.expect(",");
    }
    throw new Error("unterminated JSON array");
  }

  private readString(): string {
    const start = this.#index;
    this.expect('"');
    while (this.#index < this.source.length) {
      const token = this.source[this.#index];
      if (token === "\\") {
        this.#index += 2;
      } else if (token === '"') {
        this.#index += 1;
        const value = JSON.parse(
          this.source.slice(start, this.#index),
        ) as unknown;
        if (typeof value !== "string") throw new Error("invalid JSON key");
        return value;
      } else {
        this.#index += 1;
      }
    }
    throw new Error("unterminated JSON string");
  }

  private scanPrimitive(): void {
    while (this.#index < this.source.length) {
      const token = this.source[this.#index];
      if (
        token === "," ||
        token === "]" ||
        token === "}" ||
        isWhitespace(token)
      ) {
        return;
      }
      this.#index += 1;
    }
  }

  private consume(token: string): boolean {
    if (this.source[this.#index] !== token) return false;
    this.#index += 1;
    return true;
  }

  private expect(token: string): void {
    if (!this.consume(token)) {
      throw new Error(`invalid JSON at byte ${String(this.#index)}`);
    }
  }

  private skipWhitespace(): void {
    while (isWhitespace(this.source[this.#index])) this.#index += 1;
  }
}

function isWhitespace(token: string | undefined): boolean {
  return token === " " || token === "\t" || token === "\n" || token === "\r";
}
