import {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type KeyPairSigner,
} from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { QUEST_MESSAGE_MAX, QUEST_MESSAGE_OFFSET, QUEST_SEED, networksForCluster } from '@htn/shared';
import {
  decodePaymentResponseHeader,
  wrapFetchWithPayment,
  x402Client,
} from '@x402/fetch';
import type { Network, SelectPaymentRequirements } from '@x402/fetch';
import { registerExactSvmScheme } from '@x402/svm/exact/client';
import { toClientSvmSigner } from '@x402/svm';
import bs58 from 'bs58';

import { getErrorMessage, probeChallenge } from './challenge.ts';
import type {
  ChallengeResult,
  PaymentOutcome,
  ProgramCheckResult,
  QuestChain,
  QuestChainConfig,
  QuestStateResult,
} from './types.ts';

type LiveConfig = QuestChainConfig & { payerSecretKey: string; rpcUrl: string };

function atomicBigInt(value: unknown): bigint | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? BigInt(value) : null;
}

function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    return Promise.resolve(null);
  }
  return response.json() as Promise<unknown>;
}

function selectorFor(config: LiveConfig): SelectPaymentRequirements {
  const allowedNetworks = networksForCluster(config.cluster);
  const cap = BigInt(config.maxPaymentAtomic);
  return (x402Version, requirements) => {
    const selected = requirements.find(requirement => {
      const amount =
        x402Version === 1 && 'maxAmountRequired' in requirement
          ? requirement.maxAmountRequired
          : requirement.amount;
      const amountAtomic = atomicBigInt(amount);
      if (
        requirement.scheme !== 'exact' ||
        requirement.asset !== config.paymentMint ||
        !allowedNetworks.includes(requirement.network) ||
        requirement.payTo.trim().length === 0 ||
        amountAtomic === null
      ) {
        return false;
      }
      return amountAtomic <= cap;
    });
    if (selected === undefined) {
      throw new Error('x402 SDK refused payment requirements outside the configured asset or cap');
    }
    return selected;
  };
}

/** Decodes the borsh string in a quest PDA account. */
export function decodeQuestAccount(data: Uint8Array): string {
  const contentOffset = QUEST_MESSAGE_OFFSET + 4;
  if (data.length < contentOffset) {
    throw new Error(`quest account is too short: ${data.length} bytes`);
  }
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    QUEST_MESSAGE_OFFSET,
    true,
  );
  if (length > QUEST_MESSAGE_MAX) {
    throw new Error(`quest message length ${length} exceeds ${QUEST_MESSAGE_MAX}`);
  }
  const end = contentOffset + length;
  if (end > data.length) {
    throw new Error(`quest message ends at byte ${end}, account has ${data.length} bytes`);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(contentOffset, end));
}

/** Live Solana verification and x402 payment implementation. */
export class LiveQuestChain implements QuestChain {
  readonly enabled = true;
  readonly cluster: QuestChainConfig['cluster'];
  readonly payerAddress: string;

  private readonly rpc: ReturnType<typeof createSolanaRpc>;
  private readonly payer: KeyPairSigner;
  private readonly fetchWithPayment: ReturnType<typeof wrapFetchWithPayment>;

  private constructor(
    private readonly config: LiveConfig,
    payerAddress: string,
    payer: KeyPairSigner,
    client: x402Client,
  ) {
    this.cluster = config.cluster;
    this.payerAddress = payerAddress;
    this.rpc = createSolanaRpc(config.rpcUrl);
    this.payer = payer;
    this.fetchWithPayment = wrapFetchWithPayment(fetch, client);
  }

  static async create(config: LiveConfig): Promise<LiveQuestChain> {
    if (!Number.isSafeInteger(config.maxPaymentAtomic) || config.maxPaymentAtomic < 0) {
      throw new Error('maxPaymentAtomic must be a non-negative safe integer');
    }
    const secret = bs58.decode(config.payerSecretKey);
    if (secret.length !== 64) {
      throw new Error(`payer secret key must decode to 64 bytes, got ${secret.length}`);
    }
    const keyPairSigner = await createKeyPairSignerFromBytes(secret);
    const signer = toClientSvmSigner(keyPairSigner);
    const paymentRequirementsSelector = selectorFor(config);
    const client = new x402Client(paymentRequirementsSelector);
    client.setSpendControls(false);

    // The SDK accepts CAIP-2 patterns here and derives the corresponding v1
    // registrations itself. probeChallenge separately accepts both identifiers.
    const networks = networksForCluster(config.cluster).filter(
      (network): network is Network => network.includes(':'),
    );
    registerExactSvmScheme(client, {
      signer,
      paymentRequirementsSelector,
      networks,
    });
    return new LiveQuestChain(config, String(signer.address), keyPairSigner, client);
  }

  private async ensureRecipientTokenAccount(payTo: string): Promise<void> {
    const mint = address(this.config.paymentMint);
    const mintResponse = await this.rpc.getAccountInfo(mint, { encoding: 'base64' }).send();
    const mintAccount = mintResponse.value;
    if (mintAccount === null) {
      throw new Error(`payment mint ${mint} does not exist on ${this.config.cluster}`);
    }

    const mintOwner = String(mintAccount.owner);
    const tokenProgram =
      mintOwner === String(TOKEN_PROGRAM_ADDRESS)
        ? TOKEN_PROGRAM_ADDRESS
        : mintOwner === String(TOKEN_2022_PROGRAM_ADDRESS)
          ? TOKEN_2022_PROGRAM_ADDRESS
          : null;
    if (tokenProgram === null) {
      throw new Error(`payment mint ${mint} is not an SPL token`);
    }

    const owner = address(payTo);
    const [ata] = await findAssociatedTokenPda({ mint, owner, tokenProgram });
    const ataResponse = await this.rpc
      .getAccountInfo(ata, {
        encoding: 'base64',
        dataSlice: { offset: 0, length: 0 },
      })
      .send();
    if (ataResponse.value !== null) return;

    const latestBlockhash = (await this.rpc.getLatestBlockhash().send()).value;
    const instruction = getCreateAssociatedTokenIdempotentInstruction({
      payer: this.payer,
      ata,
      owner,
      mint,
      tokenProgram,
    });
    const transactionMessage = appendTransactionMessageInstruction(
      instruction,
      setTransactionMessageLifetimeUsingBlockhash(
        latestBlockhash,
        setTransactionMessageFeePayerSigner(
          this.payer,
          createTransactionMessage({ version: 0 }),
        ),
      ),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    const signature = getSignatureFromTransaction(signedTransaction);
    const sendTransaction = sendTransactionWithoutConfirmingFactory({ rpc: this.rpc });
    await sendTransaction(signedTransaction, { commitment: 'confirmed' });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const response = await this.rpc.getSignatureStatuses([signature]).send();
      const status = response.value[0];
      if (status?.err != null) {
        throw new Error(`recipient token account transaction failed: ${JSON.stringify(status.err)}`);
      }
      if (
        status?.confirmationStatus === 'confirmed' ||
        status?.confirmationStatus === 'finalized'
      ) {
        return;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(1_000, remainingMs)));
    }
    throw new Error(`recipient token account transaction ${signature} timed out`);
  }

  async checkProgram(programId: string): Promise<ProgramCheckResult> {
    try {
      const programAddress = address(programId);
      const response = await this.rpc
        .getAccountInfo(programAddress, {
          encoding: 'base64',
          dataSlice: { offset: 0, length: 0 },
        })
        .send();
      const account = response.value;
      return {
        skipped: false,
        deployed: account !== null,
        executable: account?.executable ?? false,
      };
    } catch (error) {
      return {
        skipped: false,
        deployed: false,
        executable: false,
        error: getErrorMessage(error),
      };
    }
  }

  async readQuestMessage(programId: string): Promise<QuestStateResult> {
    let questAddress: string | null = null;
    try {
      const programAddress = address(programId);
      const [pda] = await getProgramDerivedAddress({
        programAddress,
        seeds: [QUEST_SEED],
      });
      questAddress = String(pda);
      const response = await this.rpc.getAccountInfo(pda, { encoding: 'base64' }).send();
      const account = response.value;
      if (account === null) throw new Error(`quest account ${questAddress} does not exist`);
      if (String(account.owner) !== programId) {
        throw new Error(`quest account owner is ${account.owner}, expected ${programId}`);
      }
      const encoded = account.data[0];
      const data = Buffer.from(encoded, 'base64');
      return {
        skipped: false,
        address: questAddress,
        message: decodeQuestAccount(data),
      };
    } catch (error) {
      return {
        skipped: false,
        address: questAddress,
        message: null,
        error: getErrorMessage(error),
      };
    }
  }

  probeChallenge(endpointUrl: string): Promise<ChallengeResult> {
    return probeChallenge(endpointUrl, this.config);
  }

  async payEndpoint(endpointUrl: string): Promise<PaymentOutcome> {
    const challenge = await this.probeChallenge(endpointUrl);
    if (!challenge.ok || challenge.requirement === null) {
      return {
        ok: false,
        simulated: false,
        httpStatus: 0,
        signature: null,
        network: null,
        amountAtomic: null,
        body: null,
        error: challenge.error ?? 'challenge validation failed',
      };
    }

    try {
      await this.ensureRecipientTokenAccount(challenge.requirement.payTo);
    } catch (error) {
      return {
        ok: false,
        simulated: false,
        httpStatus: 0,
        signature: null,
        network: null,
        amountAtomic: challenge.requirement.amountAtomic,
        body: null,
        error: `could not prepare recipient token account: ${getErrorMessage(error)}`,
      };
    }

    let httpStatus = 0;
    try {
      const response = await this.fetchWithPayment(endpointUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(30_000),
      });
      httpStatus = response.status;

      const encodedSettlement =
        response.headers.get('PAYMENT-RESPONSE') ??
        response.headers.get('X-PAYMENT-RESPONSE');
      const settlement =
        encodedSettlement === null ? null : decodePaymentResponseHeader(encodedSettlement);
      const body = await readJson(response);
      const ok = response.status >= 200 && response.status < 300;
      return {
        ok,
        simulated: false,
        httpStatus,
        signature: settlement?.transaction ?? null,
        network: settlement?.network ?? null,
        amountAtomic: challenge.requirement.amountAtomic,
        body,
        ...(ok ? {} : { error: `request returned ${response.status}` }),
      };
    } catch (error) {
      return {
        ok: false,
        simulated: false,
        httpStatus,
        signature: null,
        network: null,
        amountAtomic: challenge.requirement.amountAtomic,
        body: null,
        error: getErrorMessage(error),
      };
    }
  }
}
