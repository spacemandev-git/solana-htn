import { getWallets } from '@wallet-standard/app';
import type { IdentifierString, Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, type StandardConnectFeature } from '@wallet-standard/features';
import {
	SolanaSignAndSendTransaction,
	SolanaSignMessage,
	SolanaSignTransaction,
	type SolanaSignAndSendTransactionFeature,
	type SolanaSignMessageFeature,
	type SolanaSignTransactionFeature
} from '@solana/wallet-standard-features';
import bs58 from 'bs58';
import { encodeBase64 } from './api.ts';

/** Public RPCs used when a wallet can only sign (not send) a transaction. */
const CLUSTER_RPC: Record<string, string> = {
	'solana:mainnet': 'https://api.mainnet-beta.solana.com',
	'solana:devnet': 'https://api.devnet.solana.com',
	'solana:testnet': 'https://api.testnet.solana.com',
	'solana:localnet': 'http://localhost:8899'
};

/** Override for private/local RPCs, e.g. a validator on another host. */
const RPC_OVERRIDE = import.meta.env.VITE_SOLANA_RPC_URL ?? '';

/** A registered wallet we can actually drive: connect + sign a message on Solana. */
export interface UsableWallet {
	wallet: Wallet;
	name: string;
	icon: string;
}

function isSolanaCapable(wallet: Wallet): boolean {
	const onSolana = wallet.chains.some((chain) => chain.startsWith('solana:'));
	const canConnect = StandardConnect in wallet.features;
	const canSign = SolanaSignMessage in wallet.features;
	return onSolana && canConnect && canSign;
}

/**
 * Wallet Standard bridge — no react-wallet-adapter, just `getWallets()` plus the
 * `standard:connect` and `solana:signMessage` features.
 */
export class WalletHub {
	/** Solana wallets currently registered in the page. */
	available = $state.raw<UsableWallet[]>([]);
	/** Wallets that registered but cannot sign Solana messages. */
	incompatible = $state.raw<string[]>([]);
	connected = $state.raw<Wallet | null>(null);
	account = $state.raw<WalletAccount | null>(null);
	connecting = $state(false);
	error = $state<string | null>(null);
	/** False until the first registration sweep has run. */
	scanned = $state(false);

	#off: (() => void)[] = [];

	get address(): string | null {
		return this.account?.address ?? null;
	}

	/** Starts listening for wallet registrations. Browser only. */
	start(): void {
		const api = getWallets();
		this.#refresh(api.get());
		this.scanned = true;
		this.#off.push(api.on('register', () => this.#refresh(api.get())));
		this.#off.push(api.on('unregister', () => this.#refresh(api.get())));
	}

	stop(): void {
		for (const off of this.#off) off();
		this.#off = [];
	}

	#refresh(wallets: readonly Wallet[]): void {
		const usable: UsableWallet[] = [];
		const rejected: string[] = [];
		for (const wallet of wallets) {
			if (isSolanaCapable(wallet)) usable.push({ wallet, name: wallet.name, icon: wallet.icon });
			else rejected.push(wallet.name);
		}
		this.available = usable;
		this.incompatible = rejected;
		// Drop the session if the connected wallet went away (extension disabled).
		if (this.connected && !wallets.includes(this.connected)) {
			this.connected = null;
			this.account = null;
		}
	}

	/** The Solana chain the connected account is on, e.g. `solana:devnet`. */
	get chain(): IdentifierString | null {
		const account = this.account;
		if (!account) return null;
		return account.chains.find((c) => c.startsWith('solana:')) ?? null;
	}

	/** True when the wallet can broadcast a transaction itself. */
	get canSendTransaction(): boolean {
		const wallet = this.connected;
		return wallet ? SolanaSignAndSendTransaction in wallet.features : false;
	}

	/** True when the wallet can sign a transaction we then broadcast to an RPC. */
	get canSignTransaction(): boolean {
		const wallet = this.connected;
		return wallet ? SolanaSignTransaction in wallet.features : false;
	}

	get canTransact(): boolean {
		return this.canSendTransaction || this.canSignTransaction;
	}

	async connect(wallet: Wallet): Promise<void> {
		this.connecting = true;
		this.error = null;
		try {
			const feature = wallet.features[StandardConnect] as
				| StandardConnectFeature[typeof StandardConnect]
				| undefined;
			if (!feature) throw new Error(`${wallet.name} does not support standard:connect.`);
			const { accounts } = await feature.connect();
			const account = accounts.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? accounts[0];
			if (!account) throw new Error(`${wallet.name} returned no Solana accounts.`);
			this.connected = wallet;
			this.account = account;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			throw err;
		} finally {
			this.connecting = false;
		}
	}

	disconnect(): void {
		this.connected = null;
		this.account = null;
		this.error = null;
	}

	/** Signs UTF-8 `message` with the connected account, returning a base58 signature. */
	async signMessageBase58(message: string): Promise<string> {
		const wallet = this.connected;
		const account = this.account;
		if (!wallet || !account) throw new Error('Connect a wallet first.');
		const feature = wallet.features[SolanaSignMessage] as
			| SolanaSignMessageFeature[typeof SolanaSignMessage]
			| undefined;
		if (!feature) throw new Error(`${wallet.name} does not support solana:signMessage.`);
		const outputs = await feature.signMessage({
			account,
			message: new TextEncoder().encode(message)
		});
		const first = outputs[0];
		if (!first) throw new Error('The wallet returned no signature.');
		return bs58.encode(first.signature);
	}

	/**
	 * Puts a server-built transaction on chain and returns its base58 signature.
	 *
	 * Prefers `solana:signAndSendTransaction`. Wallets that only implement
	 * `solana:signTransaction` are handled by broadcasting the signed bytes to
	 * the cluster's RPC ourselves.
	 */
	async sendTransaction(transaction: Uint8Array): Promise<string> {
		const wallet = this.connected;
		const account = this.account;
		if (!wallet || !account) throw new Error('Connect a wallet first.');
		const chain = this.chain ?? 'solana:devnet';

		const sendFeature = wallet.features[SolanaSignAndSendTransaction] as
			| SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction]
			| undefined;
		if (sendFeature) {
			const outputs = await sendFeature.signAndSendTransaction({ account, transaction, chain });
			const first = outputs[0];
			if (!first) throw new Error('The wallet returned no transaction signature.');
			return bs58.encode(first.signature);
		}

		const signFeature = wallet.features[SolanaSignTransaction] as
			| SolanaSignTransactionFeature[typeof SolanaSignTransaction]
			| undefined;
		if (!signFeature) {
			throw new Error(`${wallet.name} cannot sign Solana transactions.`);
		}
		const signed = await signFeature.signTransaction({ account, transaction, chain });
		const first = signed[0];
		if (!first) throw new Error('The wallet returned no signed transaction.');
		return await broadcast(first.signedTransaction, chain);
	}
}

/** Submits a signed transaction over plain JSON-RPC — no web3.js needed. */
async function broadcast(signedTransaction: Uint8Array, chain: IdentifierString): Promise<string> {
	const endpoint = RPC_OVERRIDE || CLUSTER_RPC[chain];
	if (!endpoint) throw new Error(`No RPC endpoint configured for ${chain}.`);
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'sendTransaction',
			params: [encodeBase64(signedTransaction), { encoding: 'base64' }]
		})
	});
	const payload = (await res.json()) as { result?: string; error?: { message?: string } };
	if (payload.error) throw new Error(payload.error.message ?? 'The RPC rejected the transaction.');
	if (!payload.result) throw new Error('The RPC returned no transaction signature.');
	return payload.result;
}

/** Wallets we point people at when nothing is installed. */
export const WALLET_LINKS = [
	{ name: 'Phantom', url: 'https://phantom.app/download' },
	{ name: 'Solflare', url: 'https://solflare.com/download' },
	{ name: 'Backpack', url: 'https://backpack.app/download' }
] as const;
