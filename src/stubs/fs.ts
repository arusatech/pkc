/** Minimal browser stubs for Node built-ins pulled in by transitive deps. */
export async function readFile(): Promise<never> {
  throw new Error("readFile is not available in the browser.");
}

export function readFileSync(): never {
  throw new Error("readFileSync is not available in the browser.");
}

export default { readFile, readFileSync };
