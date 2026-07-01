import { app, dialog, BrowserWindow } from 'electron'
import { join, basename } from 'node:path'
import { promises as fs } from 'node:fs'

interface Config {
  root: string | null
}

const configPath = (): string => join(app.getPath('userData'), 'folderify-config.json')

export async function loadRoot(): Promise<string | null> {
  try {
    const raw = await fs.readFile(configPath(), 'utf8')
    const cfg = JSON.parse(raw) as Config
    if (cfg.root) {
      // Verify it still exists and is a directory.
      const stat = await fs.stat(cfg.root)
      if (stat.isDirectory()) return cfg.root
    }
  } catch {
    // No config yet.
  }
  return null
}

export async function saveRoot(root: string | null): Promise<void> {
  const cfg: Config = { root }
  try {
    await fs.writeFile(configPath(), JSON.stringify(cfg), 'utf8')
  } catch {
    // Non-fatal.
  }
}

/** Open the native folder picker. Choosing a folder grants macOS TCC access. */
export async function chooseFolder(window: BrowserWindow | null): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    title: 'Choose your music folder',
    message: 'Pick the folder that holds your music. Each subfolder becomes a playlist.',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Use This Folder'
  }
  const result = window
    ? await dialog.showOpenDialog(window, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

export function rootName(root: string | null): string | null {
  return root ? basename(root) : null
}
