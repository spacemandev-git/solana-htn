# Hack the North x402 quest starter

This starter is the hacker-facing half of the quest. You deploy `htn_quest`,
write one message into its `quest` PDA, and run a Hono endpoint that sells the
exact same message for at most $1 in USDC.

## 1. Prepare your tools and wallet

You need [Bun](https://bun.sh/), the Solana CLI, and Anchor **2.0.0-rc.1**. Create
a wallet if you do not already have one, select devnet, and fund it with devnet
SOL for deployment fees:

```bash
solana-keygen new --outfile ~/.config/solana/id.json
solana config set --url devnet
solana airdrop 2
solana balance
```

Keep the keypair private; it controls your program and on-chain message. To test
paying your own endpoint, request devnet USDC for your paying wallet from the
[Circle faucet](https://faucet.circle.com/). Devnet SOL pays transaction fees,
while devnet USDC is the token transferred by x402.

## 2. Build and deploy `htn_quest`

From the repository root, build the deployable program and its IDL:

```bash
bun run program:build
```

Do not substitute plain `anchor build`: its output is not deployable under the
current Solana SBPFv3 requirement. The repository build script generates the
IDL, rebuilds the program as SBPFv3, and checks the binary before you deploy it.

Your first build generates a fresh program keypair under
`program/target/deploy/`, so your program ID is unique to you — but the
`declare_id!` baked into the source still names the reference ID. Sync it to
your keypair and rebuild, or the program will reject every call with
`DeclaredProgramIdMismatch`:

```bash
cd program && anchor keys sync && cd ..
bun run program:build
```

Deploy the generated `.so` to devnet, paying with your wallet:

```bash
solana program deploy program/target/deploy/htn_quest.so \
  --program-id program/target/deploy/htn_quest-keypair.json \
  --keypair ~/.config/solana/id.json \
  --url devnet

solana address -k program/target/deploy/htn_quest-keypair.json
```

Save the printed program ID. The generated program keypair must be retained if
you need to redeploy that program.

## 3. Put your message on chain

Move into `starter/`, create your local configuration, and fill in at least
`PROGRAM_ID` and `WALLET_ADDRESS`. `WALLET_ADDRESS` is the Solana address where
you want to receive USDC.

```bash
cd starter
cp .env.example .env
```

Then initialize the quest PDA with your message:

```bash
bun run set-message "the robots dream in blockhashes"
```

The helper reads the instruction discriminators from `idl/htn_quest.json`, uses
`initialize` the first time, and uses `set_message` on later runs. It prints the
transaction signature and a Solana Explorer link. Your message may use at most
256 UTF-8 bytes.

## 4. Run and test the x402 server

Review `.env`; for a normal devnet entry it should contain values like these:

```dotenv
WALLET_ADDRESS=<your Solana wallet address>
PROGRAM_ID=<your deployed program id>
PRICE_USD=1.00
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=
FACILITATOR_URL=https://facilitator.payai.network
KEYPAIR_PATH=~/.config/solana/id.json
PORT=4021
```

Start the server and confirm the unpaid route returns HTTP 402:

```bash
bun run dev
curl -i http://localhost:4021/quest
curl -s http://localhost:4021/healthz
```

The first request receives a `402 Payment Required` challenge describing the exact USDC payment. An x402 client signs a payment and retries with the `X-PAYMENT` header. The facilitator verifies the authorization and settles the USDC transfer on Solana. After settlement, the middleware allows the handler to return HTTP 200 with the on-chain message.

The server refuses to start above `$1.00`, because the event agent will never
authorize more than $1.

## 5. Expose and submit the endpoint

The agent must be able to reach your server. On venue Wi-Fi, use your machine's
LAN IP if attendees can connect to one another, for example
`http://192.168.1.23:4021/quest`. Otherwise expose the local port with a tunnel:

```bash
cloudflared tunnel --url http://localhost:4021
```

Keep the server and tunnel running. On your badge's phone page, submit both the
public endpoint URL ending in `/quest` and the deployed program ID.

## 6. What the agent checks

The event agent performs these checks in order:

1. The submitted program ID is deployed on the selected Solana cluster.
2. Its `['quest']` PDA exists and contains a valid UTF-8 message.
3. The endpoint returns x402 terms for exact USDC payment on that cluster, for no more than $1.
4. The agent pays the endpoint once.
5. The paid JSON response's `message` exactly equals the bytes decoded from the PDA.

Successful settlement sends the USDC directly to `WALLET_ADDRESS`. Do not trim,
retype, or otherwise transform the message in your HTTP handler—the comparison
is exact.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Facilitator errors or HTTP 502 | Confirm `FACILITATOR_URL` is reachable, your route uses the public devnet/mainnet RPC, and the facilitator supports the selected CAIP-2 network. Restart after correcting `.env`. |
| The 402 advertises the wrong network or asset | Make `SOLANA_CLUSTER` match the cluster where you deployed. Remove stale `SOLANA_RPC_URL` overrides and restart; devnet and mainnet use different CAIP-2 IDs and USDC mints. |
| The agent reports a message mismatch | Run `bun run set-message "…"` again, wait for confirmation, and ensure `/quest` returns that exact string without normalization, prefixes, or suffixes. |
| The badge says “agent already paid” | The verifier pays an endpoint only once to prevent duplicate charges. Keep that endpoint stable and ask event staff to reset the attempt rather than submitting repeated requests. |
