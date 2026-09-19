export interface FirmwareManifest {
	name: string;
	version: string;
	chip: string;
	builtAt: string;
	parts: { path: string; offset: number }[];
}

export type FlashStage =
	| 'idle'
	| 'loading'
	| 'connecting'
	| 'erasing'
	| 'writing'
	| 'done'
	| 'error';

export interface FlashProgress {
	stage: FlashStage;
	percent: number;
	log: string[];
	chip?: string;
	error?: string;
}

export function webSerialSupported(): boolean {
	return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export async function fetchManifest(baseUrl: string): Promise<FirmwareManifest> {
	const response = await fetch(`${baseUrl}/manifest.json`);
	if (!response.ok) throw new Error(`Could not load firmware manifest (${response.status}).`);
	return (await response.json()) as FirmwareManifest;
}

export async function flashFirmware(
	baseUrl: string,
	manifest: FirmwareManifest,
	opts: { eraseAll: boolean; onProgress: (p: FlashProgress) => void }
): Promise<void> {
	let stage: FlashStage = 'loading';
	let percent = 0;
	let chip: string | undefined;
	let disconnect: (() => Promise<void>) | undefined;
	let logLines: string[] = [];

	const emit = (error?: string): void => {
		opts.onProgress({
			stage,
			percent,
			log: [...logLines.slice(-200)],
			...(chip === undefined ? {} : { chip }),
			...(error === undefined ? {} : { error })
		});
	};
	const log = (line: string): void => {
		const next = String(line).split(/\r?\n/).filter((entry) => entry.length > 0);
		logLines = [...logLines, ...next].slice(-200);
		emit();
	};

	emit();
	try {
		const parts = await Promise.all(
			manifest.parts.map(async (part) => {
				const response = await fetch(`${baseUrl}/${part.path}`);
				if (!response.ok) {
					throw new Error(`Could not load ${part.path} (${response.status}).`);
				}
				return new Uint8Array(await response.arrayBuffer());
			})
		);
		log(`Loaded ${parts.length} firmware part${parts.length === 1 ? '' : 's'}.`);

		stage = 'connecting';
		percent = 0;
		emit();
		const { ESPLoader, Transport } = await import('esptool-js');
		const port = await navigator.serial
			.requestPort({ filters: [{ usbVendorId: 0x303a, usbProductId: 0x1001 }] })
			.catch(() => navigator.serial.requestPort());
		const transport = new Transport(port, false);
		disconnect = () => transport.disconnect();
		const loader = new ESPLoader({
			transport,
			baudrate: 460800,
			terminal: {
				clean() {},
				writeLine: (line: string) => log(line),
				write: (line: string) => log(line)
			}
		});
		chip = await loader.main();
		if (!chip.includes('C3')) throw new Error('This is not an ESP32-C3 badge');
		log(`Connected to ${chip}.`);

		const fileArray = manifest.parts.map((part, index) => {
			const data = parts[index];
			if (data === undefined) throw new Error(`Missing firmware part ${part.path}.`);
			return { data, address: part.offset };
		});
		const totalBytes = parts.reduce((total, part) => total + part.byteLength, 0);
		const completedBefore = parts.map((_, index) =>
			parts.slice(0, index).reduce((total, part) => total + part.byteLength, 0)
		);

		stage = opts.eraseAll ? 'erasing' : 'writing';
		percent = 0;
		emit();
		if (opts.eraseAll) log('Erasing flash before writing.');
		await loader.writeFlash({
			fileArray,
			flashMode: 'keep',
			flashFreq: 'keep',
			flashSize: 'keep',
			eraseAll: opts.eraseAll,
			compress: true,
			reportProgress: (fileIndex, written, total) => {
				if (stage !== 'writing') stage = 'writing';
				const partLength = parts[fileIndex]?.byteLength ?? Math.max(total, 0);
				const before = completedBefore[fileIndex] ?? 0;
				const current = Math.min(Math.max(written, 0), partLength);
				percent =
					totalBytes === 0
						? 100
						: Math.max(0, Math.min(100, Math.round(((before + current) / totalBytes) * 100)));
				emit();
			}
		});
		await loader.after('hard_reset');
		await transport.disconnect();
		disconnect = undefined;
		stage = 'done';
		percent = 100;
		log('done');
	} catch (err) {
		stage = 'error';
		const message = err instanceof Error ? err.message : String(err);
		logLines = [...logLines, message].slice(-200);
		emit(message);
		throw err;
	} finally {
		if (disconnect) {
			try {
				await disconnect();
			} catch {
				// The port may already be closed after a reset or disconnect.
			}
		}
	}
}
