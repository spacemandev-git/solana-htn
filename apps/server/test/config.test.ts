import { describe, expect, test } from 'bun:test';
import { CLUSTERS, DEFAULT_SOLANA_BOX_ID } from '@htn/shared';
import { loadConfig } from '../src/config.ts';

describe('quest configuration', () => {
  test('defaults to devnet and a one-dollar cap', () => {
    const config = loadConfig({});
    expect(config.solanaCluster).toBe('devnet');
    expect(config.maxRewardAtomic).toBe(1_000_000);
    expect(config.usdcMint).toBe(CLUSTERS.devnet.usdcMint);
    expect(config.solanaRpcUrl).toBeUndefined();
    expect(config.x402PayerSecretKey).toBeUndefined();
    expect(config.solanaBoxId).toBe(DEFAULT_SOLANA_BOX_ID);
    expect('stationApiKey' in config).toBe(false);
  });

  test('clamps finite rewards and falls back for non-finite input', () => {
    expect(loadConfig({ MAX_REWARD_USD: '-2' }).maxRewardAtomic).toBe(1);
    expect(loadConfig({ MAX_REWARD_USD: 'not-a-number' }).maxRewardAtomic).toBe(1_000_000);
  });

  test('accepts mainnet and rejects any other explicit cluster', () => {
    const mainnet = loadConfig({ SOLANA_CLUSTER: 'mainnet' });
    expect(mainnet.solanaCluster).toBe('mainnet');
    expect(mainnet.usdcMint).toBe(CLUSTERS.mainnet.usdcMint);
    expect(() => loadConfig({ SOLANA_CLUSTER: 'testnet' })).toThrow(
      'SOLANA_CLUSTER must be devnet or mainnet',
    );
  });

  test('accepts a custom Solana box id', () => {
    expect(loadConfig({ SOLANA_BOX_ID: 'solana-final' }).solanaBoxId).toBe('solana-final');
  });
});
