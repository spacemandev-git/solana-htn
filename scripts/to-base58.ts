/** Converts a Solana CLI JSON keypair file into the base58 secret the server env expects. */
import bs58 from 'bs58';

const path = process.argv[2];
if (!path) {
  console.error('usage: bun scripts/to-base58.ts <keypair.json>');
  process.exit(1);
}
const bytes = Uint8Array.from(JSON.parse(await Bun.file(path).text()) as number[]);
console.log(bs58.encode(bytes));
