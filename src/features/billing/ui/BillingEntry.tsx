import { Popover } from "@base-ui/react/popover";
import {
	ArrowSquareOut,
	CaretDown,
	CreditCard,
	type Icon,
	SignOut,
	Trash,
	UserCircle,
	WarningCircle,
} from "@phosphor-icons/react";
import {
	type ChangeEvent,
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Tooltip } from "@/shared/ui/Tooltip";
import {
	applyLocalDevBillingOverride,
	deleteCurrentAccount,
	fetchBillingEntrySnapshot,
	type LocalDevBillingPlan,
	signInWithEmail,
	signOutCurrentSession,
	signUpWithEmail,
} from "../model/api";
import {
	type BillingEntryView,
	type BillingPanelRow,
	type BillingPlanActionView,
	type BillingRecentJobsView,
	type BillingRecentJobView,
	type BillingTone,
	projectBillingEntry,
} from "../model/presentation";
import type { BillingEntryResult, UpgradeTargetPlan } from "../model/types";
import { CheckoutStatusToast } from "./CheckoutStatusToast";
import { ManageBillingDialog } from "./ManageBillingDialog";
import { useEmbeddedCheckout } from "./use-embedded-checkout";

type BillingEntryState = {
	readonly view: BillingEntryView;
	readonly refresh: () => void;
};

type BillingEntryVariant = "topBar" | "ipad";
type BillingEntryPopoverSide = "top" | "bottom";

type BillingEntryProps = {
	readonly open?: boolean;
	readonly onOpenChange?: (open: boolean) => void;
	readonly popoverSide?: BillingEntryPopoverSide;
	readonly tooltipSide?: BillingEntryPopoverSide;
	readonly variant?: BillingEntryVariant;
};

/**
 * Loads the compact account-panel read model and projects it once for the UI.
 *
 * The state stays feature-local because the TopBar entry is the only consumer.
 * Each refresh aborts the previous request so stale account, billing, or recent
 * job reads cannot win a race after sign-in, sign-out, or unmount.
 */
function useBillingEntry(): BillingEntryState {
	const [result, setResult] = useState<BillingEntryResult | null>(null);
	const activeRequestRef = useRef<AbortController | null>(null);

	const loadSnapshot = useCallback(() => {
		activeRequestRef.current?.abort();
		const controller = new AbortController();
		activeRequestRef.current = controller;
		setResult(null);
		void fetchBillingEntrySnapshot(controller.signal).then((next) => {
			if (!controller.signal.aborted) setResult(next);
		});
	}, []);

	useEffect(() => {
		loadSnapshot();
		return () => {
			activeRequestRef.current?.abort();
			activeRequestRef.current = null;
		};
	}, [loadSnapshot]);

	return { view: projectBillingEntry(result), refresh: loadSnapshot };
}

const TRIGGER_CLASS =
	"inline-flex h-8 w-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-surface-raised/86 px-0 text-ui leading-none shadow-2xl shadow-black/35 backdrop-blur-xl outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-white/55 xl:w-auto xl:max-w-40 xl:px-2 2xl:max-w-56";

const IPAD_TRIGGER_CLASS =
	"relative grid size-10 shrink-0 place-items-center rounded-md border border-hairline/10 bg-hairline/5 text-fg-secondary transition hover:border-hairline/25 hover:bg-hairline/10 hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent/60";

const PANEL_CLASS =
	"z-50 w-[min(92vw,320px)] rounded-md border border-white/12 bg-surface-raised/98 p-2 text-fg text-ui shadow-2xl shadow-black/55 outline-none backdrop-blur-xl";

const ACTION_BUTTON_BASE =
	"inline-flex h-6 min-w-0 items-center justify-center gap-1 rounded border px-1.5 font-medium text-ui leading-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-45";

const PRIMARY_ACTION_CLASS = `${ACTION_BUTTON_BASE} border-warn/40 bg-warn-surface/92 text-warn-fg hover:bg-warn-surface/95 hover:text-warn-fg focus-visible:outline-warn/60`;

const SECONDARY_ACTION_CLASS = `${ACTION_BUTTON_BASE} border-white/12 bg-white/[0.05] text-fg-secondary hover:bg-white/[0.1] hover:text-white focus-visible:outline-white/55`;

const DANGER_ACTION_CLASS = `${ACTION_BUTTON_BASE} border-danger/35 bg-danger-surface/88 text-danger-fg hover:bg-danger-surface/95 hover:text-danger-fg focus-visible:outline-danger/60`;

const AUTH_INPUT_CLASS =
	"h-7 w-full rounded border border-white/10 bg-surface-sunken px-2 text-fg text-ui leading-none outline-none placeholder:text-fg-muted focus:border-warn/45";

type AuthMode = "signIn" | "signUp";

type AuthFormFields = {
	readonly name: string;
	readonly email: string;
	readonly password: string;
};

const EMPTY_AUTH_FIELDS: AuthFormFields = {
	name: "",
	email: "",
	password: "",
};

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const REMOTE_PRODUCTION_CLOUD_DEV =
	import.meta.env.VITE_VMA_REMOTE_PRODUCTION_CLOUD_DEV === "1";
const LOCAL_DEV_PLAN_OPTIONS = [
	{ plan: "free", label: "Free" },
	{ plan: "creator", label: "Creator" },
	{ plan: "creator_pro", label: "Creator Pro" },
] as const satisfies readonly {
	readonly plan: LocalDevBillingPlan;
	readonly label: string;
}[];

const isLocalDevelopmentHost = (): boolean => {
	if (typeof globalThis.location === "undefined") return false;
	return LOCAL_DEV_HOSTS.has(globalThis.location.hostname);
};

const toneTextClass = (tone: BillingTone): string => {
	switch (tone) {
		case "accent":
			return "text-accent-fg";
		case "success":
			return "text-fg";
		case "warning":
			return "text-warn-fg";
		case "danger":
			return "text-danger-fg";
		case "neutral":
			return "text-fg-secondary";
	}
};

const toneDotClass = (tone: BillingTone): string => {
	switch (tone) {
		case "accent":
			return "bg-accent";
		case "success":
			return "bg-accent";
		case "warning":
			return "bg-warn";
		case "danger":
			return "bg-danger";
		case "neutral":
			return "bg-fg-muted";
	}
};

const triggerTone = (view: BillingEntryView): BillingTone => {
	const subscriptionRow = view.panelRows.find(
		(row) => row.label === "Subscription",
	);
	if (subscriptionRow !== undefined) return subscriptionRow.tone;
	if (view.usageOver) return "warning";
	return "neutral";
};

function ActionButton({
	icon: Icon,
	label,
	title,
	className,
	disabled,
	onClick,
}: {
	readonly icon: Icon;
	readonly label: string;
	readonly title: string;
	readonly className: string;
	readonly disabled?: boolean;
	readonly onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={className}
			disabled={disabled}
			title={title}
			onClick={onClick}
		>
			<Icon aria-hidden="true" size={12} weight="regular" />
			<span className="min-w-0 truncate">{label}</span>
		</button>
	);
}

function PanelRow({ row }: { readonly row: BillingPanelRow }) {
	return (
		<div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-start gap-2 rounded border border-white/8 bg-black/20 px-1.5 py-1">
			<div className="truncate text-fg-muted text-ui leading-4">
				{row.label}
			</div>
			<div className="min-w-0">
				<div
					className={`truncate font-medium text-ui leading-4 ${toneTextClass(row.tone)}`}
					title={row.title ?? row.value}
				>
					{row.value}
				</div>
				{row.detail ? (
					<div
						className="truncate text-fg-muted text-ui leading-3"
						title={row.detail}
					>
						{row.detail}
					</div>
				) : null}
			</div>
		</div>
	);
}

function RecentJob({ job }: { readonly job: BillingRecentJobView }) {
	return (
		<li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded border border-white/8 bg-black/20 px-1.5 py-1">
			<div className="min-w-0">
				<div className="truncate font-medium text-fg text-ui leading-4">
					{job.title}
				</div>
				<div className="truncate font-mono text-fg-muted text-ui leading-3">
					{job.meta}
				</div>
				<div className="truncate text-fg-subtle text-ui leading-3">
					{job.timestamp}
				</div>
			</div>
			<div
				className={`rounded border border-white/10 px-1 font-mono text-ui leading-3 ${toneTextClass(job.statusTone)}`}
				title={job.statusLabel}
			>
				{job.statusLabel}
			</div>
		</li>
	);
}

function RecentJobs({ jobs }: { readonly jobs: BillingRecentJobsView }) {
	if (jobs.state === "hidden") return null;

	const countLabel =
		jobs.state === "ready"
			? `${jobs.items.length} recent`
			: jobs.state === "empty"
				? "None"
				: jobs.state === "error"
					? "Issue"
					: "Loading";

	return (
		<details className="border-white/10 border-t pt-1.5">
			<summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded px-0.5 py-0.5 text-ui leading-4 hover:bg-white/[0.06]">
				<span className="font-medium text-fg-secondary">
					Server export jobs
				</span>
				<span
					className={`rounded border border-white/10 px-1 font-mono leading-3 ${jobs.state === "error" ? "text-danger-fg" : "text-fg-muted"}`}
				>
					{countLabel}
				</span>
			</summary>
			<div className="mt-1">
				{jobs.state === "loading" ? (
					<div className="rounded border border-white/8 bg-black/20 px-1.5 py-1 text-fg-muted text-ui leading-4">
						Loading
					</div>
				) : null}
				{jobs.state === "empty" ? (
					<div className="rounded border border-white/8 bg-black/20 px-1.5 py-1 text-fg-muted text-ui leading-4">
						No server export jobs
					</div>
				) : null}
				{jobs.state === "error" ? (
					<div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 rounded border border-danger/25 bg-danger-surface/50 px-1.5 py-1 text-danger-fg text-ui leading-4">
						<WarningCircle aria-hidden="true" size={12} />
						<span className="truncate">{jobs.message}</span>
					</div>
				) : null}
				{jobs.state === "ready" ? (
					<ul className="max-h-36 space-y-1 overflow-y-auto pr-1">
						{jobs.items.map((job) => (
							<RecentJob key={job.id} job={job} />
						))}
					</ul>
				) : null}
			</div>
		</details>
	);
}

function AuthForm({
	mode,
	fields,
	busy,
	error,
	onModeChange,
	onFieldsChange,
	onSubmit,
	onClose,
}: {
	readonly mode: AuthMode;
	readonly fields: AuthFormFields;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onModeChange: (mode: AuthMode) => void;
	readonly onFieldsChange: (fields: AuthFormFields) => void;
	readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	readonly onClose: () => void;
}) {
	const updateField = useCallback(
		(field: keyof AuthFormFields) => (event: ChangeEvent<HTMLInputElement>) => {
			onFieldsChange({ ...fields, [field]: event.currentTarget.value });
		},
		[fields, onFieldsChange],
	);

	return (
		<form className="flex flex-col gap-1.5" onSubmit={onSubmit}>
			<div className="grid h-6 grid-cols-2 rounded border border-white/10 bg-black/24 p-0.5">
				<button
					type="button"
					className={`rounded text-ui leading-none ${
						mode === "signIn"
							? "bg-white/14 text-fg"
							: "text-fg-muted hover:bg-white/8 hover:text-fg-secondary"
					}`}
					onClick={() => onModeChange("signIn")}
				>
					Sign in
				</button>
				<button
					type="button"
					className={`rounded text-ui leading-none ${
						mode === "signUp"
							? "bg-white/14 text-fg"
							: "text-fg-muted hover:bg-white/8 hover:text-fg-secondary"
					}`}
					onClick={() => onModeChange("signUp")}
				>
					Create
				</button>
			</div>
			{mode === "signUp" ? (
				<input
					type="text"
					name="name"
					autoComplete="name"
					className={AUTH_INPUT_CLASS}
					placeholder="Name"
					value={fields.name}
					disabled={busy}
					required
					onChange={updateField("name")}
				/>
			) : null}
			<input
				type="email"
				name="email"
				autoComplete="email"
				className={AUTH_INPUT_CLASS}
				placeholder="Email"
				value={fields.email}
				disabled={busy}
				required
				onChange={updateField("email")}
			/>
			<input
				type="password"
				name="password"
				autoComplete={mode === "signIn" ? "current-password" : "new-password"}
				className={AUTH_INPUT_CLASS}
				placeholder="Password"
				value={fields.password}
				disabled={busy}
				required
				minLength={mode === "signUp" ? 8 : undefined}
				onChange={updateField("password")}
			/>
			{error ? (
				<div
					className="max-w-full truncate font-mono text-danger-fg text-ui leading-3"
					role="alert"
					title={error}
				>
					{error}
				</div>
			) : null}
			<div className="grid grid-cols-2 gap-1">
				<button
					type="button"
					className={SECONDARY_ACTION_CLASS}
					disabled={busy}
					onClick={onClose}
				>
					Close
				</button>
				<button type="submit" className={PRIMARY_ACTION_CLASS} disabled={busy}>
					{busy ? "..." : mode === "signIn" ? "Sign in" : "Create"}
				</button>
			</div>
		</form>
	);
}

function PlanActionButton({
	action,
	busy,
	onCheckout,
	onPortal,
}: {
	readonly action: BillingPlanActionView;
	readonly busy: boolean;
	readonly onCheckout: (plan: UpgradeTargetPlan) => void;
	readonly onPortal: () => void;
}) {
	if (action.kind === "none") return null;
	if (action.kind === "checkout") {
		return (
			<ActionButton
				icon={ArrowSquareOut}
				label={busy ? "..." : action.label}
				title={action.title}
				className={PRIMARY_ACTION_CLASS}
				disabled={busy}
				onClick={() => onCheckout(action.targetPlan)}
			/>
		);
	}

	return (
		<ActionButton
			icon={ArrowSquareOut}
			label={busy ? "..." : action.label}
			title={action.title}
			className={PRIMARY_ACTION_CLASS}
			disabled={busy}
			onClick={onPortal}
		/>
	);
}

/**
 * Danger-zone control for irreversible account deletion (right to erasure).
 *
 * Collapsed to a single danger button until armed; arming reveals an inline
 * confirmation that requires re-typing the account email before the delete button
 * enables. That email is sent to the Worker, which re-checks the match, so the
 * gate is enforced on both sides. The section owns its own transient state and is
 * unmounted (state reset) when the account popover closes. On success it calls
 * {@link onDeleted}, which clears the now-dead session and refreshes the panel.
 */
function DeleteAccountSection({
	accountEmail,
	onDeleted,
}: {
	readonly accountEmail: string | null;
	readonly onDeleted: () => void;
}) {
	const [armed, setArmed] = useState(false);
	const [email, setEmail] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const canConfirm =
		!busy &&
		accountEmail !== null &&
		email.trim().toLowerCase() === accountEmail.toLowerCase();

	const onCancel = useCallback(() => {
		setArmed(false);
		setEmail("");
		setError(null);
	}, []);

	const onConfirm = useCallback(() => {
		if (accountEmail === null) return;
		setBusy(true);
		setError(null);
		void deleteCurrentAccount(email.trim()).then((result) => {
			if (!result.ok) {
				setBusy(false);
				setError(result.message);
				return;
			}
			// Leave `busy` set: a successful delete refreshes the panel to its
			// signed-out state, which unmounts this section.
			onDeleted();
		});
	}, [accountEmail, email, onDeleted]);

	if (!armed) {
		return (
			<section className="border-white/10 border-t pt-1.5">
				<ActionButton
					icon={Trash}
					label="Delete account"
					title="Permanently delete this account and all its data"
					className={DANGER_ACTION_CLASS}
					onClick={() => setArmed(true)}
				/>
			</section>
		);
	}

	return (
		<section className="flex flex-col gap-1.5 rounded border border-danger/30 bg-danger-surface/40 p-1.5">
			<div className="font-medium text-danger-fg text-ui leading-4">
				Delete account
			</div>
			<p className="text-fg-secondary text-ui leading-4">
				This permanently erases your account, subscription, workspace, usage,
				and export history. It cannot be undone. Work saved locally in this
				browser is separate and stays on this device.
			</p>
			<input
				type="email"
				name="confirmEmail"
				autoComplete="off"
				className={AUTH_INPUT_CLASS}
				placeholder={
					accountEmail === null ? "No email on file" : "Re-type your email"
				}
				value={email}
				disabled={busy || accountEmail === null}
				onChange={(event) => setEmail(event.currentTarget.value)}
			/>
			{error ? (
				<div
					className="max-w-full truncate font-mono text-danger-fg text-ui leading-3"
					role="alert"
					title={error}
				>
					{error}
				</div>
			) : null}
			<div className="grid grid-cols-2 gap-1">
				<button
					type="button"
					className={SECONDARY_ACTION_CLASS}
					disabled={busy}
					onClick={onCancel}
				>
					Cancel
				</button>
				<button
					type="button"
					className={DANGER_ACTION_CLASS}
					disabled={!canConfirm}
					onClick={onConfirm}
				>
					{busy ? "..." : "Delete"}
				</button>
			</div>
		</section>
	);
}

function LocalDevBillingSection({
	busy,
	error,
	onApply,
}: {
	readonly busy: boolean;
	readonly error: string | null;
	readonly onApply: (plan: LocalDevBillingPlan) => void;
}) {
	return (
		<section className="border-white/10 border-t pt-1.5">
			<div className="mb-1 flex items-center justify-between gap-2">
				<div className="truncate font-medium text-fg-secondary text-ui leading-4">
					Local dev plan
				</div>
				<div className="rounded border border-warn/30 px-1 font-mono text-ui leading-3 text-warn-fg">
					dev
				</div>
			</div>
			<div className="grid grid-cols-3 gap-1">
				{LOCAL_DEV_PLAN_OPTIONS.map((option) => (
					<button
						key={option.plan}
						type="button"
						className={SECONDARY_ACTION_CLASS}
						disabled={busy}
						title={`Set local account to ${option.label}`}
						onClick={() => onApply(option.plan)}
					>
						<span className="min-w-0 truncate">
							{busy ? "..." : option.label}
						</span>
					</button>
				))}
			</div>
			{error ? (
				<div
					className="mt-1 truncate rounded border border-danger/25 bg-danger-surface/50 px-1.5 py-1 text-danger-fg text-ui leading-4"
					role="status"
					title={error}
				>
					{error}
				</div>
			) : null}
		</section>
	);
}

function SignedInPanel({
	view,
	billingBusy,
	signOutBusy,
	actionFailed,
	localDevBilling,
	showAccountDeletion,
	onCheckout,
	onManage,
	onSignOut,
	onDeleted,
}: {
	readonly view: BillingEntryView;
	readonly billingBusy: boolean;
	readonly signOutBusy: boolean;
	readonly actionFailed: boolean;
	readonly localDevBilling: {
		readonly busy: boolean;
		readonly error: string | null;
		readonly onApply: (plan: LocalDevBillingPlan) => void;
	} | null;
	readonly showAccountDeletion: boolean;
	readonly onCheckout: (plan: UpgradeTargetPlan) => void;
	readonly onManage: () => void;
	readonly onSignOut: () => void;
	readonly onDeleted: () => void;
}) {
	const account = view.account;
	if (account === null) return null;

	return (
		<div className="flex flex-col gap-1.5">
			<header className="flex min-w-0 items-center gap-2">
				<div className="grid size-7 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.06] font-mono text-fg-secondary text-ui leading-none">
					{account.avatarLabel}
				</div>
				<div className="min-w-0">
					<Popover.Title className="truncate font-medium text-fg text-ui leading-4">
						{account.name}
					</Popover.Title>
					{account.email ? (
						<Popover.Description className="truncate text-fg-muted text-ui leading-3">
							{account.email}
						</Popover.Description>
					) : null}
				</div>
			</header>

			<div className="grid gap-1">
				{view.panelRows.map((row) => (
					<PanelRow key={row.label} row={row} />
				))}
			</div>

			<RecentJobs jobs={view.recentJobs} />

			{localDevBilling ? (
				<LocalDevBillingSection
					busy={localDevBilling.busy}
					error={localDevBilling.error}
					onApply={localDevBilling.onApply}
				/>
			) : null}

			<div className="grid grid-cols-2 gap-1 border-white/10 border-t pt-1.5">
				<PlanActionButton
					action={view.planAction}
					busy={billingBusy}
					onCheckout={onCheckout}
					onPortal={onManage}
				/>
				{view.canManageBilling ? (
					<ActionButton
						icon={CreditCard}
						label={billingBusy ? "..." : "Manage billing"}
						title="Manage billing"
						className={SECONDARY_ACTION_CLASS}
						disabled={billingBusy}
						onClick={onManage}
					/>
				) : null}
				<ActionButton
					icon={SignOut}
					label={signOutBusy ? "..." : "Sign out"}
					title={`Sign out ${view.accountLabel ?? "current account"}`}
					className={DANGER_ACTION_CLASS}
					disabled={signOutBusy}
					onClick={onSignOut}
				/>
			</div>

			{actionFailed ? (
				<div
					className="truncate rounded border border-danger/25 bg-danger-surface/50 px-1.5 py-1 text-danger-fg text-ui leading-4"
					role="status"
					title="Action is temporarily unavailable. The editor is unaffected."
				>
					Action unavailable
				</div>
			) : null}

			{showAccountDeletion ? (
				<DeleteAccountSection
					accountEmail={account.email}
					onDeleted={onDeleted}
				/>
			) : null}
		</div>
	);
}

function SignedOutPanel({
	mode,
	fields,
	busy,
	error,
	onModeChange,
	onFieldsChange,
	onSubmit,
	onClose,
}: {
	readonly mode: AuthMode;
	readonly fields: AuthFormFields;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onModeChange: (mode: AuthMode) => void;
	readonly onFieldsChange: (fields: AuthFormFields) => void;
	readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	readonly onClose: () => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<header className="flex min-w-0 items-center gap-2">
				<div className="grid size-7 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.06] text-fg-secondary">
					<UserCircle aria-hidden="true" size={16} />
				</div>
				<div className="min-w-0">
					<Popover.Title className="truncate font-medium text-fg text-ui leading-4">
						Guest
					</Popover.Title>
					<Popover.Description className="truncate text-fg-muted text-ui leading-3">
						Account
					</Popover.Description>
				</div>
			</header>
			<AuthForm
				mode={mode}
				fields={fields}
				busy={busy}
				error={error}
				onModeChange={onModeChange}
				onFieldsChange={onFieldsChange}
				onSubmit={onSubmit}
				onClose={onClose}
			/>
		</div>
	);
}

function LoadingPanel() {
	return (
		<div className="flex flex-col gap-1.5">
			<Popover.Title className="font-medium text-fg text-ui leading-4">
				Account
			</Popover.Title>
			<div className="rounded border border-white/8 bg-black/20 px-1.5 py-1 text-fg-muted text-ui leading-4">
				Loading
			</div>
		</div>
	);
}

function ErrorPanel() {
	return (
		<div className="flex flex-col gap-1.5">
			<Popover.Title className="font-medium text-fg text-ui leading-4">
				Account
			</Popover.Title>
			<div className="rounded border border-danger/25 bg-danger-surface/50 px-1.5 py-1 text-danger-fg text-ui leading-4">
				Billing status unavailable
			</div>
		</div>
	);
}

/**
 * Compact account, billing, and recent server-export entry for editor chrome.
 *
 * The trigger can render as the desktop top-bar entry or as an iPad quickbar
 * icon; the richer account state lives in a non-modal Base UI popover so the
 * canvas stays interactive and visible. The UI consumes only billing feature
 * HTTP mirrors and pure projection data, keeping Worker, Better Auth, Polar, and
 * export-feature implementation modules out of this bundle boundary.
 */
export function BillingEntry({
	open,
	onOpenChange,
	popoverSide = "bottom",
	tooltipSide = "bottom",
	variant = "topBar",
}: BillingEntryProps = {}) {
	const { view, refresh } = useBillingEntry();
	const [uncontrolledPanelOpen, setUncontrolledPanelOpen] = useState(false);
	const [manageOpen, setManageOpen] = useState(false);
	const [authBusy, setAuthBusy] = useState(false);
	const [signOutBusy, setSignOutBusy] = useState(false);
	const [actionFailed, setActionFailed] = useState(false);
	const [authMode, setAuthMode] = useState<AuthMode>("signIn");
	const [authFields, setAuthFields] =
		useState<AuthFormFields>(EMPTY_AUTH_FIELDS);
	const [authError, setAuthError] = useState<string | null>(null);
	const [localDevBillingBusy, setLocalDevBillingBusy] = useState(false);
	const [localDevBillingError, setLocalDevBillingError] = useState<
		string | null
	>(null);

	const checkout = useEmbeddedCheckout(refresh);
	const checkoutState = checkout.state;
	const checkoutBusy =
		checkoutState.kind === "starting" ||
		checkoutState.kind === "active" ||
		checkoutState.kind === "finalizing";
	const panelOpen = open ?? uncontrolledPanelOpen;
	const setPanelOpen = useCallback(
		(nextOpen: boolean) => {
			if (open === undefined) setUncontrolledPanelOpen(nextOpen);
			onOpenChange?.(nextOpen);
		},
		[onOpenChange, open],
	);

	useEffect(() => {
		if (view.authState !== "signedOut") {
			setAuthError(null);
		}
	}, [view.authState]);

	useEffect(() => {
		if (view.authState !== "signedIn") {
			setLocalDevBillingError(null);
			setLocalDevBillingBusy(false);
		}
	}, [view.authState]);

	const onAuthModeChange = useCallback((nextMode: AuthMode) => {
		setAuthMode(nextMode);
		setAuthError(null);
	}, []);

	const onCheckout = useCallback(
		(plan: UpgradeTargetPlan) => {
			setActionFailed(false);
			setPanelOpen(false);
			checkout.start(plan);
		},
		[checkout, setPanelOpen],
	);

	const onManage = useCallback(() => {
		setActionFailed(false);
		setPanelOpen(false);
		setManageOpen(true);
	}, [setPanelOpen]);

	const onStartCheckoutFromManage = useCallback(() => {
		setManageOpen(false);
		onCheckout(view.upgradeTarget);
	}, [onCheckout, view.upgradeTarget]);

	const onAuthSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const email = authFields.email.trim();
			const password = authFields.password;
			const name = authFields.name.trim();
			if (
				email.length === 0 ||
				password.length === 0 ||
				(authMode === "signUp" && name.length === 0)
			) {
				setAuthError("Missing required field");
				return;
			}

			setAuthBusy(true);
			setAuthError(null);
			const request =
				authMode === "signIn"
					? signInWithEmail({ email, password })
					: signUpWithEmail({ name, email, password });
			void request.then((result) => {
				setAuthBusy(false);
				if (!result.ok) {
					setAuthError(result.message);
					return;
				}
				setAuthFields(EMPTY_AUTH_FIELDS);
				refresh();
			});
		},
		[authFields.email, authFields.name, authFields.password, authMode, refresh],
	);

	const onSignOut = useCallback(() => {
		setActionFailed(false);
		setLocalDevBillingError(null);
		setSignOutBusy(true);
		void signOutCurrentSession().then((result) => {
			setSignOutBusy(false);
			if (!result.ok) {
				setActionFailed(true);
				return;
			}
			setAuthError(null);
			setAuthFields(EMPTY_AUTH_FIELDS);
			setAuthMode("signIn");
			refresh();
		});
	}, [refresh]);

	const onApplyLocalDevBilling = useCallback(
		(plan: LocalDevBillingPlan) => {
			setLocalDevBillingBusy(true);
			setLocalDevBillingError(null);
			void applyLocalDevBillingOverride(plan).then((result) => {
				setLocalDevBillingBusy(false);
				if (!result.ok) {
					setLocalDevBillingError(result.message);
					return;
				}
				refresh();
			});
		},
		[refresh],
	);

	const onAccountDeleted = useCallback(() => {
		// The account is already gone server-side (all session rows deleted). Clear
		// the now-dead session cookie, reset auth UI to a fresh signed-out state,
		// and refresh — bootstrap will resolve to signed-out regardless of whether
		// the cookie clear succeeds.
		void signOutCurrentSession().then(() => {
			setAuthError(null);
			setAuthFields(EMPTY_AUTH_FIELDS);
			setAuthMode("signIn");
			setPanelOpen(false);
			refresh();
		});
	}, [refresh, setPanelOpen]);

	const closePanel = useCallback(() => {
		setPanelOpen(false);
		setAuthError(null);
		setAuthFields((current) => ({
			...current,
			password: "",
		}));
	}, [setPanelOpen]);

	const tone = triggerTone(view);
	const triggerClass = variant === "ipad" ? IPAD_TRIGGER_CLASS : TRIGGER_CLASS;
	const localDevBilling =
		isLocalDevelopmentHost() && !REMOTE_PRODUCTION_CLOUD_DEV
			? {
					busy: localDevBillingBusy,
					error: localDevBillingError,
					onApply: onApplyLocalDevBilling,
				}
			: null;

	return (
		<>
			<Popover.Root open={panelOpen} onOpenChange={setPanelOpen} modal={false}>
				<Tooltip label={view.title} side={tooltipSide} align="end">
					<Popover.Trigger
						type="button"
						className={triggerClass}
						aria-label={view.title}
					>
						{variant === "ipad" ? (
							<>
								<UserCircle aria-hidden="true" size={18} />
								<span
									className={`absolute right-2 bottom-2 size-1.5 rounded-full ${toneDotClass(tone)}`}
								/>
							</>
						) : (
							<>
								<span
									className={`size-1.5 shrink-0 rounded-full ${toneDotClass(tone)}`}
								/>
								<span
									className="hidden max-w-20 truncate font-medium text-fg text-ui leading-3 xl:inline"
									title={view.planLabel}
								>
									{view.planLabel}
								</span>
							</>
						)}
						{variant === "topBar" && view.usageOver && view.usageText ? (
							<span
								className="top-bar-wide-label max-w-24 truncate font-mono text-ui leading-3 text-warn-fg"
								title={view.usageText}
							>
								{view.usageText}
							</span>
						) : null}
						{variant === "topBar" && view.statusNote ? (
							<span
								className="top-bar-wide-label max-w-20 truncate rounded border border-warn/35 px-1 font-mono text-ui leading-3 text-warn-fg"
								title={view.statusNote}
							>
								{view.statusNote}
							</span>
						) : null}
						{variant === "topBar" ? (
							<CaretDown
								aria-hidden="true"
								className="shrink-0 text-fg-muted"
								size={10}
							/>
						) : null}
					</Popover.Trigger>
				</Tooltip>
				<Popover.Portal>
					<Popover.Positioner
						align="end"
						className="z-50 outline-none"
						collisionPadding={8}
						side={popoverSide}
						sideOffset={6}
					>
						<Popover.Popup className={PANEL_CLASS}>
							{view.kind === "loading" ? <LoadingPanel /> : null}
							{view.kind === "ready" && view.authState === "unknown" ? (
								<ErrorPanel />
							) : null}
							{view.kind === "ready" && view.authState === "signedOut" ? (
								<SignedOutPanel
									mode={authMode}
									fields={authFields}
									busy={authBusy}
									error={authError}
									onModeChange={onAuthModeChange}
									onFieldsChange={setAuthFields}
									onSubmit={onAuthSubmit}
									onClose={closePanel}
								/>
							) : null}
							{view.kind === "ready" && view.authState === "signedIn" ? (
								<SignedInPanel
									view={view}
									billingBusy={checkoutBusy}
									signOutBusy={signOutBusy}
									actionFailed={actionFailed}
									localDevBilling={localDevBilling}
									showAccountDeletion={!REMOTE_PRODUCTION_CLOUD_DEV}
									onCheckout={onCheckout}
									onManage={onManage}
									onSignOut={onSignOut}
									onDeleted={onAccountDeleted}
								/>
							) : null}
						</Popover.Popup>
					</Popover.Positioner>
				</Popover.Portal>
			</Popover.Root>
			<ManageBillingDialog
				open={manageOpen}
				onOpenChange={setManageOpen}
				onStartCheckout={onStartCheckoutFromManage}
				onStatusChange={refresh}
			/>
			<CheckoutStatusToast state={checkoutState} onDismiss={checkout.dismiss} />
		</>
	);
}
