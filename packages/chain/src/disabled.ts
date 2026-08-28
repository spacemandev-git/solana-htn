import { getErrorMessage, probeChallenge } from './challenge.ts';
import type {
  ChallengeResult,
  PaymentOutcome,
  ProgramCheckResult,
  QuestChain,
  QuestChainConfig,
  QuestStateResult,
} from './types.ts';

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json') && !contentType.includes('+json')) return null;
  return response.json() as Promise<unknown>;
}

/** No-wallet implementation used for local demos and validation-only flows. */
export class DisabledQuestChain implements QuestChain {
  readonly enabled = false;
  readonly payerAddress = null;
  readonly cluster: QuestChainConfig['cluster'];

  constructor(private readonly config: QuestChainConfig) {
    this.cluster = config.cluster;
  }

  checkProgram(_programId: string): Promise<ProgramCheckResult> {
    return Promise.resolve({ skipped: true, deployed: false, executable: false });
  }

  readQuestMessage(_programId: string): Promise<QuestStateResult> {
    return Promise.resolve({ skipped: true, address: null, message: null });
  }

  probeChallenge(endpointUrl: string): Promise<ChallengeResult> {
    return probeChallenge(endpointUrl, this.config);
  }

  async payEndpoint(endpointUrl: string): Promise<PaymentOutcome> {
    const payment = Buffer.from(
      JSON.stringify({ x402Version: 2, simulated: true }),
      'utf8',
    ).toString('base64');

    let httpStatus = 0;
    try {
      const response = await fetch(endpointUrl, {
        method: 'GET',
        headers: { 'X-PAYMENT': payment },
        signal: AbortSignal.timeout(10_000),
      });
      httpStatus = response.status;
      const ok = response.status >= 200 && response.status < 300;
      const body = await readJson(response);
      return {
        ok,
        simulated: true,
        httpStatus,
        signature: null,
        network: null,
        amountAtomic: null,
        body,
        ...(ok ? {} : { error: `request returned ${response.status}` }),
      };
    } catch (error) {
      return {
        ok: false,
        simulated: true,
        httpStatus,
        signature: null,
        network: null,
        amountAtomic: null,
        body: null,
        error: getErrorMessage(error),
      };
    }
  }
}
