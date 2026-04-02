import { realpathSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

export function getRepoRootFromEntryFile(entryFile: string): string {
  return dirname(dirname(entryFile))
}

export function getRepoRootFromModuleUrl(moduleUrl: string): string {
  return getRepoRootFromEntryFile(realpathSync(fileURLToPath(moduleUrl)))
}

export function getScanRootsForRepo(repoRoot: string): string[] {
  return [join(repoRoot, 'src'), join(repoRoot, 'vendor')]
}
