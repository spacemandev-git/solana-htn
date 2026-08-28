import { CLUSTERS } from '@htn/shared';

import { DisabledQuestChain } from './disabled.ts';
import type { QuestChain, QuestChainConfig } from './types.ts';

export async function createQuestChain(config: QuestChainConfig): Promise<QuestChain> {
  const rpcUrl = config.rpcUrl ?? CLUSTERS[config.cluster].defaultRpcUrl;
  if (config.payerSecretKey === undefined || config.payerSecretKey.length === 0) {
    return new DisabledQuestChain({ ...config, rpcUrl });
  }

  const { LiveQuestChain } = await import('./live.ts');
  return LiveQuestChain.create({
    ...config,
    rpcUrl,
    payerSecretKey: config.payerSecretKey,
  });
}
