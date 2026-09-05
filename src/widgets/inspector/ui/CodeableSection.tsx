import { Code, X } from "@phosphor-icons/react";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	type BindablePropertyDescriptor,
	bindablePropertiesForGeometryKind,
	bindablePropertiesForTargetScope,
} from "@/entities/scene/model/bindable-property";
import {
	type EffectCapabilityDescriptor,
	effectCapabilityById,
} from "@/entities/scene/model/effect-capabilities";
import {
	type NativeExpressionPropertyId,
	nativeExpressionPropertyIdFromBindableId,
} from "@/entities/scene/model/native-expression-binding";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import {
	commitDuplicateGenerator,
	type DuplicateGeneratorChannelKey,
	planDuplicateGenerator,
	removeDuplicateGenerator,
} from "@/features/duplicate-generator/model/commands";
import {
	clearFrameEffectExpression,
	clearNodeEffectExpression,
	commitFrameEffectExpression,
	commitNodeEffectExpression,
	type FrameEffectExpressionTargetRef,
	planFrameEffectExpression,
	planNodeEffectExpression,
} from "@/features/effect-expression/model/commands";
import {
	clearNativeExpression,
	commitNativeExpression,
	planNativeExpression,
} from "@/features/native-expression/model/commands";
import type { FrameEffectRecipeScope } from "../model/editing";

/**
 * Inspector "Code" surfaces: binds expression-bindable native properties and
 * node/frame look controls to a formula. Duplicate generator controls are
 * exported for the Inspector's first-class Duplicate section. All edits flow
 * through feature command bridges, so the command bus owns undo/redo; these
 * components hold only draft text + parse errors.
 */

const FIELD_CLASS =
	"h-6 w-full rounded-md border border-white/10 bg-black/25 px-1.5 font-mono text-fg text-ui tabular-nums outline-none transition placeholder:text-fg-subtle focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45";

const LABEL_CLASS = "mb-0.5 block text-fg-subtle text-ui";

const ERROR_CLASS = "mt-0.5 block font-mono text-danger text-ui";

const HINT_CLASS = "mt-1 block text-fg-subtle text-ui";

type NativePropertyDescriptor = BindablePropertyDescriptor & {
	readonly id: NativeExpressionPropertyId;
	readonly source: Extract<
		BindablePropertyDescriptor["source"],
		{ readonly kind: "scene-property" }
	>;
};

const NATIVE_PROPERTY_CONTROLS: readonly NativePropertyDescriptor[] =
	bindablePropertiesForTargetScope("node").filter(
		(property): property is NativePropertyDescriptor =>
			property.source.kind === "scene-property" &&
			nativeExpressionPropertyIdFromBindableId(property.id) !== null,
	);

const NODE_LOOK_CAPABILITIES: readonly EffectCapabilityDescriptor[] =
	bindablePropertiesForTargetScope("node")
		.map((property) =>
			property.source.kind === "effect-capability"
				? effectCapabilityById(property.source.capabilityId)
				: null,
		)
		.filter(
			(capability): capability is EffectCapabilityDescriptor =>
				capability?.source.kind === "recipe-control" &&
				capability.control.expressionBindable,
		);

const frameEffectCapabilitiesForScope = (
	scope: "artboard" | "scene",
): readonly EffectCapabilityDescriptor[] =>
	bindablePropertiesForTargetScope(scope)
		.map((property) =>
			property.source.kind === "effect-capability"
				? effectCapabilityById(property.source.capabilityId)
				: null,
		)
		.filter((capability): capability is EffectCapabilityDescriptor => {
			if (capability === null) return false;
			return (
				capability.control.expressionBindable &&
				(capability.source.kind === "recipe-control" ||
					capability.source.kind === "influence-control")
			);
		});

function Field({
	label,
	defaultValue,
	placeholder,
	error,
	disabled = false,
	onCommit,
	onChange,
}: {
	readonly label: string;
	readonly defaultValue: string;
	readonly placeholder: string;
	readonly error?: string | null;
	readonly disabled?: boolean;
	readonly onCommit: (value: string) => void;
	readonly onChange?: () => void;
}) {
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.currentTarget.blur();
		}
	};
	return (
		<label className="block min-w-0">
			<span className={LABEL_CLASS}>{label}</span>
			<input
				type="text"
				spellCheck={false}
				autoComplete="off"
				defaultValue={defaultValue}
				placeholder={placeholder}
				disabled={disabled}
				onChange={onChange}
				onBlur={(event) => onCommit(event.currentTarget.value)}
				onKeyDown={onKeyDown}
				className={FIELD_CLASS}
			/>
			{error ? <span className={ERROR_CLASS}>{error}</span> : null}
		</label>
	);
}

function NativeCodeControls({ nodeId }: { readonly nodeId: string }) {
	const document = useSceneStore((state) => state.document);
	const bindings = useSceneStore(
		(state) => state.document.nativeExpressionBindings,
	);
	const node = useMemo(() => findNode(document, nodeId), [document, nodeId]);
	const propertyControls = useMemo(() => {
		if (!node) return [];
		const eligible = new Set(
			bindablePropertiesForGeometryKind(node.geometry.kind).map(
				(property) => property.id,
			),
		);
		return NATIVE_PROPERTY_CONTROLS.filter((property) =>
			eligible.has(property.id),
		);
	}, [node]);
	const nodeBindings = useMemo(
		() => (bindings ?? []).filter((binding) => binding.nodeId === nodeId),
		[bindings, nodeId],
	);
	const [propertyId, setPropertyId] = useState<NativeExpressionPropertyId>(
		NATIVE_PROPERTY_CONTROLS[0]?.id ?? "transform.x",
	);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const firstProperty = propertyControls[0];
		if (!firstProperty) return;
		if (propertyControls.some((property) => property.id === propertyId)) return;
		setPropertyId(firstProperty.id);
		setError(null);
	}, [propertyControls, propertyId]);

	const current = nodeBindings.find(
		(binding) => binding.propertyId === propertyId,
	);

	const onCommit = (value: string) => {
		if (value.trim().length === 0) {
			clearNativeExpression(propertyId, nodeId);
			setError(null);
			return;
		}
		const plan = planNativeExpression(propertyId, nodeId, value);
		if (plan.kind === "error") {
			setError(plan.error.message);
			return;
		}
		if (plan.kind === "unknown-property") {
			setError("This property cannot be coded.");
			return;
		}
		if (plan.kind === "ineligible-target") {
			setError("This property cannot be coded for this node.");
			return;
		}
		setError(null);
		commitNativeExpression(plan);
	};

	return (
		<div className="flex flex-col gap-1.5">
			<label className="block min-w-0">
				<span className={LABEL_CLASS}>Property</span>
				<select
					value={propertyId}
					onChange={(event) => {
						setPropertyId(
							event.currentTarget.value as NativeExpressionPropertyId,
						);
						setError(null);
					}}
					className={FIELD_CLASS}
				>
					{propertyControls.map((property) => (
						<option key={property.id} value={property.id}>
							{property.label}
						</option>
					))}
				</select>
			</label>
			<Field
				key={`${propertyId}:${current?.expr.source ?? ""}`}
				label="Expression"
				defaultValue={current?.expr.source ?? ""}
				placeholder="value + sin(time) * 24"
				error={error}
				onChange={() => setError(null)}
				onCommit={onCommit}
			/>
			{nodeBindings.length > 0 ? (
				<ul className="flex flex-col gap-0.5">
					{nodeBindings.map((binding) => (
						<BindingRow
							key={binding.id}
							active={binding.propertyId === propertyId}
							label={
								NATIVE_PROPERTY_CONTROLS.find(
									(property) => property.id === binding.propertyId,
								)?.label ?? binding.propertyId
							}
							source={binding.expr.source}
							onSelect={() => {
								setPropertyId(binding.propertyId);
								setError(null);
							}}
							onClear={() => clearNativeExpression(binding.propertyId, nodeId)}
						/>
					))}
				</ul>
			) : null}
			<span className={HINT_CLASS}>Variables: time, frame, value</span>
		</div>
	);
}

function EffectCodeControls({ nodeId }: { readonly nodeId: string }) {
	const bindings = useSceneStore(
		(state) => state.document.effectExpressionBindings,
	);
	const nodeBindings = useMemo(
		() =>
			(bindings ?? []).filter(
				(binding) =>
					binding.targetRef.kind === "node" &&
					binding.targetRef.nodeId === nodeId,
			),
		[bindings, nodeId],
	);
	const [capabilityId, setCapabilityId] = useState(
		NODE_LOOK_CAPABILITIES[0]?.id ?? "",
	);
	const [error, setError] = useState<string | null>(null);

	const current = nodeBindings.find(
		(binding) => binding.capabilityId === capabilityId,
	);

	const onCommit = (value: string) => {
		if (value.trim().length === 0) {
			clearNodeEffectExpression(capabilityId, nodeId);
			setError(null);
			return;
		}
		const plan = planNodeEffectExpression(capabilityId, nodeId, value);
		if (plan.kind === "error") {
			setError(plan.error.message);
			return;
		}
		if (plan.kind === "unknown-capability") {
			setError("This control cannot be coded.");
			return;
		}
		setError(null);
		commitNodeEffectExpression(plan);
	};

	return (
		<div className="flex flex-col gap-1.5">
			<label className="block min-w-0">
				<span className={LABEL_CLASS}>Effect parameter</span>
				<select
					value={capabilityId}
					onChange={(event) => {
						setCapabilityId(event.currentTarget.value);
						setError(null);
					}}
					className={FIELD_CLASS}
				>
					{NODE_LOOK_CAPABILITIES.map((capability) => (
						<option key={capability.id} value={capability.id}>
							{capability.label}
						</option>
					))}
				</select>
			</label>
			<Field
				key={`${capabilityId}:${current?.expr.source ?? ""}`}
				label="Expression"
				defaultValue={current?.expr.source ?? ""}
				placeholder="value + sin(time) * 0.5"
				error={error}
				onChange={() => setError(null)}
				onCommit={onCommit}
			/>
			{nodeBindings.length > 0 ? (
				<ul className="flex flex-col gap-0.5">
					{nodeBindings.map((binding) => (
						<BindingRow
							key={binding.id}
							active={binding.capabilityId === capabilityId}
							label={
								NODE_LOOK_CAPABILITIES.find(
									(capability) => capability.id === binding.capabilityId,
								)?.label ?? binding.capabilityId
							}
							source={binding.expr.source}
							onSelect={() => {
								setCapabilityId(binding.capabilityId);
								setError(null);
							}}
							onClear={() =>
								clearNodeEffectExpression(binding.capabilityId, nodeId)
							}
						/>
					))}
				</ul>
			) : null}
			<span className={HINT_CLASS}>Variables: time, frame, value</span>
		</div>
	);
}

function BindingRow({
	active = false,
	label,
	source,
	disabled = false,
	onSelect,
	onClear,
}: {
	readonly active?: boolean;
	readonly label: string;
	readonly source: string;
	readonly disabled?: boolean;
	readonly onSelect?: () => void;
	readonly onClear: () => void;
}) {
	return (
		<li
			className={`flex items-center justify-between gap-1 rounded-md border px-1 py-0.5 ${
				active
					? "border-accent/45 bg-accent-surface text-accent-fg"
					: "border-transparent bg-black/20 text-fg-secondary"
			}`}
		>
			<button
				type="button"
				disabled={disabled || !onSelect}
				onClick={onSelect}
				aria-pressed={active}
				title={`${label}: ${source}`}
				className="min-w-0 flex-1 truncate text-left font-mono text-ui disabled:cursor-default"
			>
				<span className={active ? "text-accent-fg" : "text-fg-subtle"}>
					{label}
				</span>{" "}
				{source}
			</button>
			<button
				type="button"
				onClick={onClear}
				aria-label={`Clear ${label} expression`}
				disabled={disabled}
				className="shrink-0 rounded-sm p-0.5 text-fg-subtle transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
			>
				<X aria-hidden="true" size={11} />
			</button>
		</li>
	);
}

const frameExpressionTargetRef = (
	scope: FrameEffectRecipeScope,
	artboardId: string,
): FrameEffectExpressionTargetRef =>
	scope === "scene" ? { kind: "scene" } : { kind: "artboard", artboardId };

export function FrameEffectCodeControls({
	scope,
	artboardId,
	disabled,
}: {
	readonly scope: FrameEffectRecipeScope;
	readonly artboardId: string;
	readonly disabled: boolean;
}) {
	const targetRef = useMemo(
		() => frameExpressionTargetRef(scope, artboardId),
		[scope, artboardId],
	);
	const capabilities = useMemo(
		() => frameEffectCapabilitiesForScope(targetRef.kind),
		[targetRef.kind],
	);
	const bindings = useSceneStore(
		(state) => state.document.effectExpressionBindings,
	);
	const frameBindings = useMemo(
		() =>
			(bindings ?? []).filter((binding) =>
				targetRef.kind === "scene"
					? binding.targetRef.kind === "scene"
					: binding.targetRef.kind === "artboard" &&
						binding.targetRef.artboardId === targetRef.artboardId,
			),
		[bindings, targetRef],
	);
	const [capabilityId, setCapabilityId] = useState(capabilities[0]?.id ?? "");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (capabilities.some((capability) => capability.id === capabilityId)) {
			return;
		}
		setCapabilityId(capabilities[0]?.id ?? "");
		setError(null);
	}, [capabilities, capabilityId]);

	const current = frameBindings.find(
		(binding) => binding.capabilityId === capabilityId,
	);

	const onCommit = (value: string) => {
		if (disabled || capabilityId.length === 0) return;
		if (value.trim().length === 0) {
			clearFrameEffectExpression(capabilityId, targetRef);
			setError(null);
			return;
		}
		const plan = planFrameEffectExpression(capabilityId, targetRef, value);
		if (plan.kind === "error") {
			setError(plan.error.message);
			return;
		}
		if (plan.kind === "unknown-capability") {
			setError("This control cannot be coded.");
			return;
		}
		setError(null);
		commitFrameEffectExpression(plan);
	};

	if (capabilities.length === 0) return null;

	return (
		<div className="rounded-md border border-white/8 bg-black/15 p-1">
			<div className="mb-1 flex h-5 items-center justify-between gap-1 text-ui">
				<span className="text-fg-muted">Code</span>
				<span className="font-mono text-fg-subtle">
					{targetRef.kind === "scene" ? "scene" : "frame"}
					{frameBindings.length > 0 ? ` / ${frameBindings.length} coded` : ""}
				</span>
			</div>
			<div className="flex flex-col gap-1.5">
				<label className="block min-w-0">
					<span className={LABEL_CLASS}>Effect parameter</span>
					<select
						value={capabilityId}
						disabled={disabled}
						onChange={(event) => {
							setCapabilityId(event.currentTarget.value);
							setError(null);
						}}
						className={FIELD_CLASS}
					>
						{capabilities.map((capability) => (
							<option key={capability.id} value={capability.id}>
								{capability.label}
							</option>
						))}
					</select>
				</label>
				<Field
					key={`${targetRef.kind}:${targetRef.kind === "artboard" ? targetRef.artboardId : "scene"}:${capabilityId}:${current?.expr.source ?? ""}`}
					label="Expression"
					defaultValue={current?.expr.source ?? ""}
					placeholder="value + sin(time) * 0.5"
					error={error}
					disabled={disabled}
					onChange={() => setError(null)}
					onCommit={onCommit}
				/>
				{frameBindings.length > 0 ? (
					<ul className="flex flex-col gap-0.5">
						{frameBindings.map((binding) => (
							<BindingRow
								key={binding.id}
								active={binding.capabilityId === capabilityId}
								label={
									capabilities.find(
										(capability) => capability.id === binding.capabilityId,
									)?.label ?? binding.capabilityId
								}
								source={binding.expr.source}
								disabled={disabled}
								onSelect={() => {
									setCapabilityId(binding.capabilityId);
									setError(null);
								}}
								onClear={() =>
									clearFrameEffectExpression(binding.capabilityId, targetRef)
								}
							/>
						))}
					</ul>
				) : null}
				<span className={HINT_CLASS}>Variables: time, frame, value</span>
			</div>
		</div>
	);
}

export function DuplicateCodeControls({ nodeId }: { readonly nodeId: string }) {
	const generators = useSceneStore(
		(state) => state.document.duplicateGenerators,
	);
	const generator = (generators ?? []).find(
		(entry) => entry.sourceNodeId === nodeId,
	);
	const generatorFields = useMemo(
		() => ({
			count: generator?.count.source ?? "",
			x: generator?.instance.x?.source ?? "",
			y: generator?.instance.y?.source ?? "",
			rotation: generator?.instance.rotation?.source ?? "",
		}),
		[
			generator?.count.source,
			generator?.instance.x?.source,
			generator?.instance.y?.source,
			generator?.instance.rotation?.source,
		],
	);
	const [errors, setErrors] = useState<
		Partial<Record<DuplicateGeneratorChannelKey, string>>
	>({});
	const [fields, setFields] = useState(generatorFields);

	useEffect(() => {
		setFields(generatorFields);
		setErrors({});
	}, [generatorFields]);

	const commit = (next: typeof fields) => {
		setFields(next);
		if (next.count.trim().length === 0) {
			removeDuplicateGenerator(nodeId);
			setErrors({});
			return;
		}
		const plan = planDuplicateGenerator(nodeId, next);
		if (plan.kind === "error") {
			setErrors({ [plan.field]: plan.error.message });
			return;
		}
		setErrors({});
		commitDuplicateGenerator(plan);
	};

	const channel = (
		key: DuplicateGeneratorChannelKey,
		label: string,
		placeholder: string,
	): ReactNode => (
		<Field
			key={`${key}:${fields[key]}`}
			label={label}
			defaultValue={fields[key]}
			placeholder={placeholder}
			error={errors[key]}
			onCommit={(value) => commit({ ...fields, [key]: value })}
		/>
	);

	return (
		<div className="flex flex-col gap-1.5">
			{channel("count", "Count", "8")}
			<div className="grid grid-cols-2 gap-1.5">
				{channel("x", "X", "i * 40")}
				{channel("y", "Y", "0")}
			</div>
			{channel("rotation", "Rotation", "i * 15")}
			{generator ? (
				<button
					type="button"
					onClick={() => {
						removeDuplicateGenerator(nodeId);
						setFields({ count: "", x: "", y: "", rotation: "" });
						setErrors({});
					}}
					className="self-start rounded-md border border-white/10 px-1.5 py-0.5 text-fg-subtle text-ui transition hover:text-fg"
				>
					Remove generator
				</button>
			) : null}
			<span className={HINT_CLASS}>Variables: i, count, seed, time, frame</span>
		</div>
	);
}

function SubHeading({ children }: { readonly children: ReactNode }) {
	return (
		<span className="mt-1 block font-medium text-fg-secondary text-ui first:mt-0">
			{children}
		</span>
	);
}

/**
 * Mounts the Code authoring surface for a single selected node. Renders nothing for
 * multi-selection paths, which pass no node id.
 */
export function CodeableSection({ nodeId }: { readonly nodeId: string }) {
	return (
		<section className="border-white/8 border-b px-1.5 pb-1.5 last:border-b-0">
			<div className="sticky top-0 z-20 -mx-1.5 mb-1.5 flex h-6 items-center justify-between gap-1 border-white/8 border-b bg-surface-raised/96 px-1.5 text-fg-secondary text-ui backdrop-blur-xl">
				<div className="flex min-w-0 items-center gap-1 font-medium">
					<Code aria-hidden="true" size={12} />
					<span className="truncate">Code</span>
				</div>
			</div>
			<div className="flex flex-col gap-1.5">
				<SubHeading>Native</SubHeading>
				<NativeCodeControls nodeId={nodeId} />
				<SubHeading>Effect</SubHeading>
				<EffectCodeControls nodeId={nodeId} />
			</div>
		</section>
	);
}
