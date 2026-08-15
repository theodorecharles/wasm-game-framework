function text(bytes) {
  return String.fromCharCode(...bytes);
}

export async function validateFixture({ size, policy, read, digest }) {
  if (policy.throwMessage) throw new Error(String(policy.throwMessage));
  if (policy.readBeyond) await read(size, 1);
  const signature = String(policy.signature || 'GAME');
  const requested = Number(policy.readBytes || signature.length);
  const header = text(await read(0, requested));
  if (header.slice(0, signature.length) !== signature) {
    return { accepted: false, error: `expected ${signature} signature` };
  }
  if (policy.secondRead) await read(0, requested);
  const fingerprint = policy.digest ? await digest(policy.digest) : null;
  return {
    accepted: true,
    identity: policy.identity || 'fixture-data',
    version: policy.contentVersion || '1',
    fingerprint,
    metadata: { signature, inspected: requested }
  };
}

export async function validateMediaFixture({ files, totalSize, policy, file }) {
  if (policy.throwMessage) throw new Error(String(policy.throwMessage));
  const required = Array.from(policy.requiredFiles || []);
  const missing = required.find(name => !file(name));
  if (missing) return { accepted: false, error: `missing referenced file ${missing}` };
  const primary = String(policy.primary || files[0]?.name || '');
  const selected = file(primary);
  if (!selected) return { accepted: false, error: `missing primary file ${primary}` };
  const signature = String(policy.signature || 'MEDIA');
  const header = text(await selected.read(0, Number(policy.readBytes || signature.length)));
  if (header.slice(0, signature.length) !== signature) {
    return { accepted: false, error: `expected ${signature} signature` };
  }
  if (policy.secondRead) await selected.read(0, signature.length);
  return {
    accepted: true,
    label: policy.label || 'Fixture media',
    primary,
    identity: policy.identity || 'fixture-media',
    version: policy.contentVersion || '1',
    metadata: { kind: policy.kind || 'fixture', totalSize, files: files.length }
  };
}

export default validateFixture;
