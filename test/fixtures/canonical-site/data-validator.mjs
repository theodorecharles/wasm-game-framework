export default async function validateFixture({ read }) {
  const header = await read(0, 1);
  return header[0] === 0x46
    ? { accepted: true, identity: 'fixture' }
    : { accepted: false, error: 'fixture signature mismatch' };
}
