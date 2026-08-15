import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function transformMediaFixture({ files, outputDirectory, policy }) {
  if (!files.some(file => file.name === 'setup.exe')) return { transformed: false };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'game.cue'), 'MEDIA descriptor');
  await writeFile(path.join(outputDirectory, 'track01.bin'), 'track');
  return { transformed: true, label: policy.label };
}

export async function transformMediaSymlink({ outputDirectory }) {
  await mkdir(outputDirectory, { recursive: true });
  await symlink('/etc/passwd', path.join(outputDirectory, 'escape.bin'));
  return { transformed: true };
}
