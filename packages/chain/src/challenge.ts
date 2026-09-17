import { networksForCluster } from '@htn/shared';

import type {
  ChallengeRequirement,
  ChallengeResult,
  QuestChainConfig,
} from './types.ts';

type ChallengeConfig = Pick<QuestChainConfig, 'cluster' | 'maxPaymentAtomic' | 'paymentMint'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

function field(entry: Record<string, unknown>, name: string): string | null {
  const value = entry[name];
  return typeof value === 'string' ? value : null;
}

/** Validates an already-decoded x402 v1 or v2 challenge envelope. */
export function validateChallengeEnvelope(
  envelope: unknown,
  config: ChallengeConfig,
): ChallengeResult {
  if (!isRecord(envelope) || !Array.isArray(envelope.accepts)) {
    return { ok: false, requirement: null, error: 'challenge has no accepts array' };
  }
  if (!Number.isSafeInteger(config.maxPaymentAtomic) || config.maxPaymentAtomic < 0) {
    return { ok: false, requirement: null, error: 'payment cap must be a non-negative safe integer' };
  }

  const entries = envelope.accepts.filter(isRecord);
  const exact = entries.filter(entry => field(entry, 'scheme') === 'exact');
  if (exact.length === 0) {
    return { ok: false, requirement: null, error: 'no accepts entry with scheme "exact"' };
  }

  const networks = networksForCluster(config.cluster);
  const onNetwork = exact.filter(entry => {
    const network = field(entry, 'network');
    return network !== null && networks.includes(network);
  });
  if (onNetwork.length === 0) {
    return {
      ok: false,
      requirement: null,
      error: `no accepts entry for ${networks.join('/')}`,
    };
  }

  const forAsset = onNetwork.filter(entry => field(entry, 'asset') === config.paymentMint);
  if (forAsset.length === 0) {
    return {
      ok: false,
      requirement: null,
      error: `no accepts entry for asset ${config.paymentMint}`,
    };
  }

  let invalidAmount = false;
  let emptyPayTo = false;
  let overCap: number | null = null;

  for (const entry of forAsset) {
    const amount = parseAmount(entry.amount ?? entry.maxAmountRequired);
    if (amount === null) {
      invalidAmount = true;
      continue;
    }
    const payTo = field(entry, 'payTo');
    if (payTo === null || payTo.trim().length === 0) {
      emptyPayTo = true;
      continue;
    }
    if (amount > config.maxPaymentAtomic) {
      overCap ??= amount;
      continue;
    }

    const requirement: ChallengeRequirement = {
      scheme: 'exact',
      network: field(entry, 'network') ?? '',
      asset: config.paymentMint,
      payTo,
      amountAtomic: amount,
    };
    const description = field(entry, 'description');
    if (description !== null) requirement.description = description;
    return { ok: true, requirement };
  }

  if (overCap !== null) {
    return {
      ok: false,
      requirement: null,
      error: `asks ${overCap} base units, cap is ${config.maxPaymentAtomic}`,
    };
  }
  if (emptyPayTo) {
    return { ok: false, requirement: null, error: 'payment payTo must be non-empty' };
  }
  if (invalidAmount) {
    return {
      ok: false,
      requirement: null,
      error: 'payment amount must be a non-negative safe integer in base units',
    };
  }
  return { ok: false, requirement: null, error: 'no valid accepts entry' };
}

function decodeHeaderEnvelope(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as unknown;
}

/** Parses and validates a fetched challenge response without issuing another request. */
export async function parseChallengeResponse(
  response: Response,
  config: ChallengeConfig,
): Promise<ChallengeResult> {
  if (response.status !== 402) {
    return { ok: false, requirement: null, error: `expected 402, got ${response.status}` };
  }

  let body: unknown;
  let bodyError: string | null = null;
  try {
    const bodyText = await response.text();
    if (bodyText.trim().length > 0) body = JSON.parse(bodyText) as unknown;
  } catch (error) {
    bodyError = getErrorMessage(error);
  }

  if (isRecord(body) && Array.isArray(body.accepts)) {
    return validateChallengeEnvelope(body, config);
  }

  let headerError: string | null = null;
  for (const name of ['PAYMENT-REQUIRED', 'X-PAYMENT-REQUIRED']) {
    const encoded = response.headers.get(name);
    if (encoded === null) continue;
    try {
      return validateChallengeEnvelope(decodeHeaderEnvelope(encoded), config);
    } catch (error) {
      headerError ??= getErrorMessage(error);
    }
  }

  if (bodyError !== null) {
    return { ok: false, requirement: null, error: `malformed challenge JSON: ${bodyError}` };
  }
  if (headerError !== null) {
    return { ok: false, requirement: null, error: `malformed payment-required header: ${headerError}` };
  }
  return { ok: false, requirement: null, error: 'challenge has no accepts array' };
}

/** Fetches an x402 challenge once and converts every failure into a result. */
export async function probeChallenge(
  endpointUrl: string,
  config: ChallengeConfig,
): Promise<ChallengeResult> {
  try {
    const response = await fetch(endpointUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    return await parseChallengeResponse(response, config);
  } catch (error) {
    return { ok: false, requirement: null, error: getErrorMessage(error) };
  }
}
