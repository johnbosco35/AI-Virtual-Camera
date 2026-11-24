import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Launches the local Python AI engine (apps/engine) with a per-launch token, so only this app's
 * renderer can use it. Set AVS_ENGINE_EXTERNAL=1 to use an engine you started yourself
 * (then AVS_ENGINE_TOKEN must match its AVS_TOKEN).
 */
export interface EngineHandle {
  baseUrl: string;
  token: string;
  dataDir: string;
  stop: () => void;
}

function findEngineDir(appRoot: string) {
  const candidates = [
    process.env.AVS_ENGINE_DIR,
    path.resolve(appRoot, '../engine'),
    path.resolve(appRoot, '../../apps/engine'),
    path.resolve(process.resourcesPath ?? appRoot, 'engine'),
  ].filter(Boolean) as string[];
  return candidates.find((dir) => existsSync(path.join(dir, 'main.py')));
}

function findPython(engineDir: string) {
  if (process.env.AVS_ENGINE_PYTHON) return process.env.AVS_ENGINE_PYTHON;
  const venv = process.platform === 'win32' ? path.join(engineDir, '.venv', 'Scripts', 'python.exe') : path.join(engineDir, '.venv', 'bin', 'python');
  return existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3';
}

export function startEngine(appRoot: string, userData: string): EngineHandle {
  const port = Number(process.env.AVS_PORT ?? 8765);
  const baseUrl = `http://127.0.0.1:${port}`;
  if (process.env.AVS_ENGINE_EXTERNAL === '1') {
    return { baseUrl, token: process.env.AVS_ENGINE_TOKEN ?? '', dataDir: process.env.AVS_DATA_DIR ?? '(external engine)', stop: () => undefined };
  }

  const token = randomBytes(24).toString('hex');
  const engineDir = findEngineDir(appRoot);
  // Development keeps data next to the engine (models are large); packaged builds use the user profile.
  const dataDir = process.env.AVS_DATA_DIR ?? (engineDir && !engineDir.includes('resources') ? path.join(engineDir, 'data') : path.join(userData, 'engine-data'));
  mkdirSync(dataDir, { recursive: true });
  if (!engineDir) {
    console.error('[engine] apps/engine not found; voice features are unavailable.');
    return { baseUrl, token, dataDir, stop: () => undefined };
  }

  let child: ChildProcess | null = spawn(findPython(engineDir), ['main.py'], {
    cwd: engineDir,
    env: { ...process.env, AVS_TOKEN: token, AVS_PORT: String(port), AVS_DATA_DIR: dataDir, PYTHONUNBUFFERED: '1' },
    windowsHide: true,
  });
  child.stdout?.on('data', (chunk) => process.stdout.write(`[engine] ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[engine] ${chunk}`));
  child.on('exit', (code) => {
    console.log(`[engine] exited with code ${code}`);
    child = null;
  });
  child.on('error', (error) => console.error('[engine] failed to start:', error.message));

  return {
    baseUrl,
    token,
    dataDir,
    stop: () => {
      if (!child) return;
      child.kill();
      child = null;
    },
  };
}
