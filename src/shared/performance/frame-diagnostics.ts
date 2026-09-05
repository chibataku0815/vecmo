/**
 * Bounded, metadata-only phase diagnostics for interactive frame pipelines.
 * Callers own the phase names; this module only aggregates timings, counters,
 * and gauges and never retains authored content or identifiers.
 */

const MAX_PHASES = 48;
const MAX_SAMPLES_PER_PHASE = 240;

type PhaseSample = {
	readonly at: number;
	readonly durationMs: number;
};

export type FramePhaseSummary = {
	readonly averageMs: number;
	readonly count: number;
	readonly lastMs: number;
	readonly maxMs: number;
	readonly p95Ms: number;
};

export type FrameDiagnosticsSnapshot = {
	readonly counters: Readonly<Record<string, number>>;
	readonly gauges: Readonly<Record<string, number>>;
	readonly phases: Readonly<Record<string, FramePhaseSummary>>;
	readonly sampledAt: number;
};

const samplesByPhase = new Map<string, PhaseSample[]>();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
let diagnosticsEnabled = false;

/** Enables collection for the editor host; standalone/runtime bundles stay disabled. */
export function setFrameDiagnosticsEnabled(enabled: boolean): void {
	diagnosticsEnabled = enabled;
	if (!enabled) resetFrameDiagnostics();
}

const phaseSamples = (phase: string): PhaseSample[] | null => {
	let samples = samplesByPhase.get(phase);
	if (samples) return samples;
	if (samplesByPhase.size >= MAX_PHASES) return null;
	samples = [];
	samplesByPhase.set(phase, samples);
	return samples;
};

/** Records one completed phase. Production builds pay only the guard cost. */
export function recordFramePhase(phase: string, durationMs: number): void {
	if (!diagnosticsEnabled || !Number.isFinite(durationMs)) return;
	const samples = phaseSamples(phase);
	if (!samples) return;
	samples.push({ at: performance.now(), durationMs: Math.max(0, durationMs) });
	if (samples.length > MAX_SAMPLES_PER_PHASE) {
		samples.splice(0, samples.length - MAX_SAMPLES_PER_PHASE);
	}
}

/** Starts a phase timer and returns an idempotent completion callback. */
export function beginFramePhase(phase: string): () => void {
	if (!diagnosticsEnabled) return () => {};
	const startedAt = performance.now();
	let completed = false;
	return () => {
		if (completed) return;
		completed = true;
		recordFramePhase(phase, performance.now() - startedAt);
	};
}

/** Adds a bounded diagnostic counter without retaining per-frame events. */
export function addFrameDiagnosticCount(name: string, amount = 1): void {
	if (!diagnosticsEnabled || !Number.isFinite(amount)) return;
	counters.set(name, (counters.get(name) ?? 0) + amount);
}

/** Replaces a numeric diagnostic gauge such as the last committed frame. */
export function setFrameDiagnosticGauge(name: string, value: number): void {
	if (!diagnosticsEnabled || !Number.isFinite(value)) return;
	gauges.set(name, value);
}

const percentile95 = (values: readonly number[]): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	return (
		sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ??
		0
	);
};

/** Returns a detached snapshot suitable for DevTools or a support report. */
export function getFrameDiagnosticsSnapshot(): FrameDiagnosticsSnapshot {
	const phases: Record<string, FramePhaseSummary> = {};
	for (const [phase, samples] of samplesByPhase) {
		const values = samples.map((sample) => sample.durationMs);
		const total = values.reduce((sum, value) => sum + value, 0);
		phases[phase] = {
			averageMs: values.length > 0 ? total / values.length : 0,
			count: values.length,
			lastMs: values.at(-1) ?? 0,
			maxMs: Math.max(0, ...values),
			p95Ms: percentile95(values),
		};
	}
	return {
		counters: Object.fromEntries(counters),
		gauges: Object.fromEntries(gauges),
		phases,
		sampledAt: performance.now(),
	};
}

/** Clears every rolling phase and aggregate value. */
export function resetFrameDiagnostics(): void {
	samplesByPhase.clear();
	counters.clear();
	gauges.clear();
}
