export function isUserCorrectableFsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false

  const anyErr = err as any
  const code = anyErr?.code
  if (typeof code !== 'string') return false

  return [
    'EACCES',
    'EPERM',
    'EROFS',
    'ENOTDIR',
    'EISDIR',
    'ENOENT',
    'EEXIST',
    'ELOOP',
    'ENAMETOOLONG',
  ].includes(code)
}
