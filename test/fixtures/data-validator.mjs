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

export default validateFixture;
