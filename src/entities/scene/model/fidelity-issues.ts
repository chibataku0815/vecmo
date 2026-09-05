export type SceneFidelityIssueTargetKind =
	| "artboard"
	| "asset"
	| "layer"
	| "node"
	| "requested-artboard"
	| "source"
	| "track";

export type SceneFidelityIssueAffectedTarget = {
	readonly kind: SceneFidelityIssueTargetKind;
	readonly id: string;
	readonly label?: string;
	readonly role?: string;
	readonly source?: string;
	readonly ref?: string;
	readonly path?: string;
};

const defaultTargetKindRank: Readonly<
	Record<SceneFidelityIssueTargetKind, number>
> = {
	artboard: 0,
	node: 1,
	layer: 2,
	asset: 3,
	source: 4,
	track: 5,
	"requested-artboard": 6,
};

/**
 * Stable target identity for import/export fidelity review rows. Target ids
 * carry different namespaces per kind, so the key keeps kind plus source-locator
 * detail instead of comparing ids alone.
 */
export function sceneFidelityIssueTargetKey(
	target: SceneFidelityIssueAffectedTarget,
): string {
	return [
		target.kind,
		target.id,
		target.role ?? "",
		target.source ?? "",
		target.ref ?? "",
		target.path ?? "",
	].join(":");
}

/** Stable source-locator list for fidelity issue metadata. */
export function sortedSceneFidelitySourcePaths(
	values: readonly (string | undefined)[],
): readonly string[] {
	return [
		...new Set(values.filter((value): value is string => Boolean(value))),
	].sort((left, right) => left.localeCompare(right));
}

/**
 * Dedupe and sort fidelity issue targets for deterministic import/export
 * reports. Feature-specific summaries may pass a narrower rank map while using
 * the same source/path/role-aware identity contract.
 */
export function sortedSceneFidelityIssueTargets<
	Target extends SceneFidelityIssueAffectedTarget,
>(
	targets: readonly (Target | undefined)[],
	rank: Readonly<
		Partial<Record<SceneFidelityIssueTargetKind, number>>
	> = defaultTargetKindRank,
): readonly Target[] {
	return [
		...new Map(
			targets
				.filter(
					(target): target is Target =>
						target !== undefined && target.id.length > 0,
				)
				.map(
					(target) => [sceneFidelityIssueTargetKey(target), target] as const,
				),
		).values(),
	].sort((left, right) => {
		const leftRank = rank[left.kind] ?? defaultTargetKindRank[left.kind];
		const rightRank = rank[right.kind] ?? defaultTargetKindRank[right.kind];
		const rankDelta = leftRank - rightRank;
		if (rankDelta !== 0) return rankDelta;
		const idDelta = left.id.localeCompare(right.id);
		if (idDelta !== 0) return idDelta;
		const roleDelta = (left.role ?? "").localeCompare(right.role ?? "");
		if (roleDelta !== 0) return roleDelta;
		const sourceDelta = (left.source ?? "").localeCompare(right.source ?? "");
		if (sourceDelta !== 0) return sourceDelta;
		const refDelta = (left.ref ?? "").localeCompare(right.ref ?? "");
		if (refDelta !== 0) return refDelta;
		return (left.path ?? "").localeCompare(right.path ?? "");
	});
}
