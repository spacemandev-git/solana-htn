# Hack the North on-chain x402 quest

Your mission is to deploy `htn_quest`, store a message in its singleton PDA,
and sell that exact message from an x402-protected HTTP endpoint for no more
than 1.00 of the cluster's payment token. The copyable
[starter kit](../starter/) contains the Hono server, the on-chain message
helper, and an environment template.

## 1. Prepare your tools and wallet

Install [Bun](https://bun.sh/), the Solana CLI, and Anchor
**2.0.0-rc.1**. Create a wallet, switch to devnet, and request devnet SOL for
deployment fees:

```bash
solana-keygen new --outfile ~/.config/solana/id.json
solana config set --url devnet
solana airdrop 2
solana balance
```

Never share the keypair. On devnet, you only need devnet SOL for deployment
fees. The event agent pays in **HTN Bucks (`HTN`)**, a plain SPL token with six
decimals that the event mints; you do not need any payment tokens or a faucet.
Its mint address is pinned in `starter/src/chain.ts`. On mainnet, the same code charges USDC.

## 2. Build and deploy

Run the supported build from the repository root:

```bash
bun run program:build
```

Plain `anchor build` output is not deployable under Solana's current SBPFv3
requirement. The repository build script produces the IDL, rebuilds the `.so`
as SBPFv3, and validates it.

Your first build generates a fresh program keypair under
`program/target/deploy/`, so your program ID is unique to you — but the
`declare_id!` baked into the source still names the reference ID. Sync it to
your keypair and rebuild, or the program will reject every call with
`DeclaredProgramIdMismatch`:

```bash
cd program && anchor keys sync && cd ..
bun run program:build
```

Deploy to devnet with your wallet, then print and save the program ID:

```bash
solana program deploy program/target/deploy/htn_quest.so \
  --program-id program/target/deploy/htn_quest-keypair.json \
  --keypair ~/.config/solana/id.json \
  --url devnet

solana address -k program/target/deploy/htn_quest-keypair.json
```

Keep the generated program keypair; it is required to redeploy the same
program ID.

## 3. Write the message

Configure the starter and set the required values in `.env`:

```bash
cd starter
cp .env.example .env
```

Set `PROGRAM_ID` to the deployed ID and `WALLET_ADDRESS` to the Solana address
that should receive the cluster's payment token. If its token account does not
exist yet, the agent creates it and pays the rent—you do not. Then write a
non-empty message of at most 256 UTF-8 bytes:

```bash
bun run set-message "the robots dream in blockhashes"
```

The command initializes the `['quest']` PDA on its first run and updates it on
later runs. It takes the `initialize` and `set_message` discriminators from the
generated `idl/htn_quest.json`, then prints the confirmed signature and an
Explorer link.

## 4. Run and test the endpoint

A typical devnet `.env` looks like this:

```dotenv
WALLET_ADDRESS=<your Solana wallet address>
PROGRAM_ID=<your deployed program id>
PRICE_USD=1.00
SOLANA_CLUSTER=devnet
PAYMENT_MINT=
PAYMENT_SYMBOL=
SOLANA_RPC_URL=
FACILITATOR_URL=https://facilitator.payai.network
KEYPAIR_PATH=~/.config/solana/id.json
PORT=4021
```

Start the server, then verify `/quest` is paywalled and `/healthz` is open:

```bash
bun run dev
curl -i http://localhost:4021/quest
curl -s http://localhost:4021/healthz
```

The first request receives a `402 Payment Required` challenge describing the
exact payment in the cluster's payment mint. An x402 client signs a payment and
retries with the `X-PAYMENT` header. The facilitator verifies the authorization
and settles the token transfer on Solana. After settlement, the middleware
allows the handler to return HTTP 200 with the on-chain message. Leave
`PAYMENT_MINT` and `PAYMENT_SYMBOL` blank to use the cluster defaults; they are
available as explicit overrides when needed. `PRICE_USD` keeps its legacy name:
`1.00` means 1,000,000 base units of the configured payment mint.

The starter refuses to boot if `PRICE_USD` exceeds `1.00`, matching the event
agent's one-token payment cap.

## 5. Expose and submit

Give the agent a URL it can reach. A LAN address such as
`http://192.168.1.23:4021/quest` may work on venue Wi-Fi; otherwise use a tunnel
such as:

```bash
cloudflared tunnel --url http://localhost:4021
```

Leave the server and tunnel running. Open your badge's phone page and submit
the endpoint URL ending in `/quest` together with your program ID.

## 6. What the event agent checks

The checks happen in this order:

1. The program ID is deployed on the selected cluster.
2. The program's `['quest']` PDA contains a valid UTF-8 message.
3. The endpoint returns x402 terms for an exact payment in the cluster's payment mint, for no more than 1.00 token (`PRICE_USD`).
4. The agent pays the endpoint once.
5. The paid response's `message` exactly matches the message read from chain.

The settled payment token lands directly at `WALLET_ADDRESS`. The agent creates
its token account if needed and pays that account's rent. The response must
preserve the on-chain string exactly—whitespace, capitalization, and Unicode
all count.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Facilitator errors or HTTP 502 | Confirm `FACILITATOR_URL` is reachable, the configured RPC is public, and the facilitator supports the selected CAIP-2 network. Restart after editing `.env`. |
| The 402 uses the wrong network or payment mint | Make `SOLANA_CLUSTER` match the deployment, remove stale `SOLANA_RPC_URL` or `PAYMENT_MINT` overrides, and restart. Devnet and mainnet have different network IDs and payment mints. |
| The agent reports a message mismatch | Run `bun run set-message "…"` again, wait for confirmation, and return the exact on-chain string from `/quest` without trimming or decoration. |
| The badge says “agent already paid” | The verifier pays each endpoint only once to avoid duplicate charges. Keep the submitted endpoint stable and ask event staff to reset the attempt. |
