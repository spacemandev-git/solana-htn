import { describe, expect, test } from 'bun:test';
import { CLUSTERS, DEFAULT_SOLANA_BOX_ID, DEFAULT_SOLANA_FINAL_BOX_ID } from '@htn/shared';
import { loadConfig } from '../src/config.ts';

describe('quest configuration', () => {
  test('defaults to devnet and a one-token cap', () => {
    const config = loadConfig({});
    expect(config.solanaCluster).toBe('devnet');
    expect(config.maxRewardAtomic).toBe(1_000_000);
    expect(config.paymentMint).toBe(CLUSTERS.devnet.paymentMint);
    expect(config.paymentSymbol).toBe('HTN');
    expect(config.solanaRpcUrl).toBeUndefined();
    expect(config.x402PayerSecretKey).toBeUndefined();
    expect(config.solanaBoxId).toBe(DEFAULT_SOLANA_BOX_ID);
    expect(config.solanaFinalBoxId).toBe(DEFAULT_SOLANA_FINAL_BOX_ID);
    expect('stationApiKey' in config).toBe(false);
  });

  test('clamps finite rewards and falls back for non-finite input', () => {
    expect(loadConfig({ MAX_REWARD_USD: '-2' }).maxRewardAtomic).toBe(1);
    expect(loadConfig({ MAX_REWARD_USD: 'not-a-number' }).maxRewardAtomic).toBe(1_000_000);
  });

  test('accepts mainnet and rejects any other explicit cluster', () => {
    const mainnet = loadConfig({ SOLANA_CLUSTER: 'mainnet' });
    expect(mainnet.solanaCluster).toBe('mainnet');
    expect(mainnet.paymentMint).toBe(CLUSTERS.mainnet.paymentMint);
    expect(() => loadConfig({ SOLANA_CLUSTER: 'testnet' })).toThrow(
      'SOLANA_CLUSTER must be devnet or mainnet',
    );
  });

  test('accepts a custom payment mint and symbol', () => {
    const config = loadConfig({
      PAYMENT_MINT: 'So11111111111111111111111111111111111111112',
      PAYMENT_SYMBOL: 'WSOL',
    });
    expect(config.paymentMint).toBe('So11111111111111111111111111111111111111112');
    expect(config.paymentSymbol).toBe('WSOL');
  });

  test('accepts custom Solana box ids', () => {
    const config = loadConfig({
      SOLANA_BOX_ID: ' solana-first ',
      SOLANA_FINAL_BOX_ID: ' solana-final ',
    });
    expect(config.solanaBoxId).toBe('solana-first');
    expect(config.solanaFinalBoxId).toBe('solana-final');
  });
});
