export function writeOutLine(writeOut: ((str: string) => void) | undefined, message: string): void {
  writeOut?.(`${message}\n`)
}
