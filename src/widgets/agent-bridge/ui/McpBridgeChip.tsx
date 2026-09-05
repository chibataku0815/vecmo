import { Popover } from "@base-ui/react/popover";
import { CaretDown, Check, Copy, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentBridgeStore } from "@/features/agent/model/approval-store";
import { Tooltip } from "@/shared/ui/Tooltip";

/**
 * Ambient connection indicator for the live agent bridge.
 *
 * The bridge session is *persistent* state — it lasts the whole time an MCP
 * client is paired — so it belongs in the top chrome as a glanceable status
 * chip, NOT in the bottom-center toast slot (that slot is reserved for the
 * transient approval decision in {@link AgentApprovalBanner}, and a permanent
 * card there blanketed the tool-rail/timeline controls). Collapsed it is a
 * status dot + "MCP" label; clicking reveals the connection config so a person
 * can copy it into their client. The config is connect-once, so a successful
 * copy auto-collapses the popover — the dot stays as the "still connected?"
 * home and the danger state for drops/errors.
 *
 * The chip renders for both the local dev-relay connection (`bun run
 * agent:bridge` + `/editor` auto-discovery, which never sets `remoteSession`)
 * and a paired remote session, in either case only once the bridge has
 * actually connected once; it then stays mounted through subsequent drops as
 * the ambient reconnect indicator, since the local connection auto-retries on
 * an interval. A dev session that has never connected stays hidden so the
 * discovery poll's connecting/disconnected oscillation does not flicker the
 * chip in every plain dev session with no relay running.
 */

const CHIP_BASE_CLASS =
	"inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-md border bg-surface-raised/86 px-0 text-ui leading-none shadow-2xl shadow-black/35 backdrop-blur-xl outline-none transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-white/55 xl:w-auto xl:px-2";

const PANEL_CLASS =
	"z-50 w-[min(92vw,320px)] rounded-md border border-white/12 bg-surface-raised/98 p-2 text-fg text-ui shadow-2xl shadow-scrim/55 outline-none backdrop-blur-xl";

const ROW_CLASS =
	"grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-2 rounded border border-white/8 bg-black/20 px-1.5 py-1";

const COPY_BUTTON_CLASS =
	"inline-flex h-6 w-full items-center justify-center gap-1 rounded border border-white/12 bg-white/[0.05] px-1.5 font-medium text-fg-secondary text-ui leading-none hover:bg-white/[0.1] hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-white/55";

type BridgeTone = "connected" | "connecting" | "error";

const CHIP_TONE_CLASS: Record<BridgeTone, string> = {
	connected: "border-white/10 text-fg hover:border-accent/45",
	connecting: "border-white/10 text-fg-secondary",
	error: "border-danger/35 bg-danger-surface/60 text-danger-fg",
};

const DOT_TONE_CLASS: Record<BridgeTone, string> = {
	connected: "bg-accent",
	connecting: "bg-warn",
	error: "bg-danger",
};

const STATUS_LABEL: Record<BridgeTone, string> = {
	connected: "接続中",
	connecting: "接続を確立中",
	error: "エラー",
};

const ARIA_LABEL: Record<BridgeTone, string> = {
	connected: "MCP bridge: connected",
	connecting: "MCP bridge: connecting",
	error: "MCP bridge: error",
};

const COPY_RESET_MS = 1_400;

export function McpBridgeChip() {
	const status = useAgentBridgeStore((state) => state.status);
	const remoteSession = useAgentBridgeStore((state) => state.remoteSession);
	const remoteError = useAgentBridgeStore((state) => state.remoteError);
	const transportKind = useAgentBridgeStore((state) => state.transportKind);
	const autoApplyEdits = useAgentBridgeStore((state) => state.autoApplyEdits);
	const setAutoApplyEdits = useAgentBridgeStore(
		(state) => state.setAutoApplyEdits,
	);
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const [announce, setAnnounce] = useState("");
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [everConnected, setEverConnected] = useState(false);

	useEffect(() => {
		if (status === "connected") setEverConnected(true);
	}, [status]);

	const tone: BridgeTone = remoteError
		? "error"
		: status === "connected"
			? "connected"
			: "connecting";
	// Sourced from the explicit `transportKind` fact (set once by whichever
	// connection function `useAgentBridge` calls), not inferred from
	// `remoteSession` nullability: `remoteSession` also reverts to null when a
	// production bridge session fetch fails, which previously mislabeled that
	// failure as the local dev bridge instead of the remote session it was.
	const localDevBridge = transportKind === "local";
	const effectiveAutoApply = autoApplyEdits || localDevBridge;
	const bridgeModeLabel = localDevBridge ? "Local" : "Remote";
	const triggerTooltipLabel =
		tone === "connected" && localDevBridge
			? "MCP bridge: local dev relay connected · auto-approve"
			: tone === "connected" && remoteSession
				? autoApplyEdits
					? "MCP bridge: remote session connected · auto edits"
					: "MCP bridge: remote session connected"
				: remoteSession
					? "MCP bridge: remote session reconnecting"
					: transportKind === "remote"
						? "MCP bridge: remote session error"
						: ARIA_LABEL[tone];
	const triggerLabel =
		tone === "connected" && localDevBridge
			? "MCP · Local"
			: transportKind === "remote"
				? "MCP · Remote"
				: "MCP";

	const bridgeConfig = useMemo(() => {
		if (!remoteSession) return "";
		return JSON.stringify(
			{
				kind: "remote",
				baseUrl: remoteSession.baseUrl,
				sessionId: remoteSession.sessionId,
				token: remoteSession.token,
			},
			null,
			2,
		);
	}, [remoteSession]);

	// Announce connection transitions to assistive tech (the chip itself is a
	// disclosure button, so the live region lives separately to avoid the
	// double-announce of a focusable element that is also a status region).
	useEffect(() => {
		if (remoteError) {
			setAnnounce(`MCP bridge エラー: ${remoteError}`);
			return;
		}
		if (status === "connected") setAnnounce("MCP bridge 接続");
		else if (status === "connecting") setAnnounce("MCP bridge 接続中");
		else if (status === "disconnected") setAnnounce("MCP bridge 切断");
	}, [status, remoteError]);

	useEffect(
		() => () => {
			if (resetTimer.current) clearTimeout(resetTimer.current);
		},
		[],
	);

	// Keep the polite live region mounted even when the chip itself is hidden, so
	// a full disconnect (session cleared, status → "disconnected") still announces
	// the transition to assistive tech instead of silently unmounting.
	const bridgeVisible =
		remoteSession !== null ||
		remoteError !== null ||
		status === "connected" ||
		(everConnected && status !== "idle");
	if (!bridgeVisible) {
		return (
			<div className="sr-only" role="status" aria-live="polite">
				{announce}
			</div>
		);
	}

	const copyBridgeConfig = async (): Promise<void> => {
		if (!bridgeConfig) return;
		await navigator.clipboard.writeText(bridgeConfig);
		setCopied(true);
		setAnnounce("MCP bridge の設定をコピーしました");
		if (resetTimer.current) clearTimeout(resetTimer.current);
		// Recede ≠ remove: collapse the connect-once config back behind the dot
		// once it has been copied, leaving the ambient status chip in place.
		resetTimer.current = setTimeout(() => {
			setCopied(false);
			setOpen(false);
		}, COPY_RESET_MS);
	};

	return (
		<>
			<Popover.Root open={open} onOpenChange={setOpen} modal={false}>
				<Tooltip label={triggerTooltipLabel} side="bottom" align="end">
					<Popover.Trigger
						type="button"
						aria-label={triggerTooltipLabel}
						className={`pointer-events-auto ${CHIP_BASE_CLASS} ${CHIP_TONE_CLASS[tone]}`}
					>
						{tone === "error" ? (
							<WarningCircle aria-hidden="true" size={11} weight="fill" />
						) : (
							<span
								aria-hidden="true"
								className={`size-1.5 shrink-0 rounded-full ${DOT_TONE_CLASS[tone]}`}
							/>
						)}
						<span className="hidden font-medium leading-none xl:inline">
							{triggerLabel}
						</span>
						<CaretDown
							aria-hidden="true"
							size={9}
							className="hidden text-fg-muted 2xl:block"
						/>
					</Popover.Trigger>
				</Tooltip>
				<Popover.Portal>
					<Popover.Positioner
						className="z-50 outline-none"
						side="bottom"
						align="end"
						sideOffset={6}
						collisionPadding={8}
					>
						<Popover.Popup className={PANEL_CLASS}>
							<div className="flex items-center justify-between gap-2">
								<span className="font-medium text-accent-fg leading-4">
									MCP bridge
								</span>
								<span
									className={`shrink-0 rounded border px-1 text-ui leading-3 ${CHIP_TONE_CLASS[tone]}`}
								>
									{bridgeModeLabel} / {STATUS_LABEL[tone]}
								</span>
							</div>

							<div className="mt-1.5 flex items-center justify-between gap-2 rounded border border-white/8 bg-black/20 px-1.5 py-1">
								<span className="min-w-0 truncate text-fg-muted text-ui leading-4">
									{localDevBridge ? "開発時は自動承認" : "編集を自動適用"}
								</span>
								{localDevBridge ? (
									<span className="shrink-0 rounded border border-accent/45 bg-accent-surface/80 px-1.5 py-0.5 font-medium text-accent-fg text-ui leading-none">
										オン
									</span>
								) : (
									<button
										type="button"
										role="switch"
										aria-checked={effectiveAutoApply}
										aria-label="編集を自動適用"
										onClick={() => setAutoApplyEdits(!autoApplyEdits)}
										className={`shrink-0 rounded border px-1.5 py-0.5 font-medium text-ui leading-none ${
											autoApplyEdits
												? "border-accent/45 bg-accent-surface/80 text-accent-fg"
												: "border-white/12 bg-white/[0.05] text-fg-secondary hover:bg-white/[0.1] hover:text-white"
										}`}
									>
										{autoApplyEdits ? "オン" : "オフ"}
									</button>
								)}
							</div>

							{remoteError ? (
								<p className="mt-1.5 rounded border border-danger/30 bg-danger-surface/50 px-1.5 py-1 text-danger-fg text-ui leading-4">
									{remoteError}
								</p>
							) : null}

							{!remoteSession && !remoteError ? (
								<p className="mt-1.5 text-fg-muted text-ui leading-4">
									ローカル開発リレー経由の接続です。編集/保存リクエストは承認バナーなしで自動承認されます。
								</p>
							) : null}

							{remoteSession ? (
								<>
									<p className="mt-1.5 text-fg-muted text-ui leading-4">
										エージェント / MCP
										クライアントにこの設定を貼り付けて接続します。
									</p>
									<div className="mt-1.5 space-y-1">
										<div className={ROW_CLASS}>
											<div className="truncate text-fg-muted text-ui leading-4">
												Base URL
											</div>
											<div
												className="min-w-0 break-all font-mono text-fg-secondary text-ui leading-4"
												title={remoteSession.baseUrl}
											>
												{remoteSession.baseUrl}
											</div>
										</div>
										<div className={ROW_CLASS}>
											<div className="truncate text-fg-muted text-ui leading-4">
												Session
											</div>
											<div
												className="min-w-0 break-all font-mono text-fg-secondary text-ui leading-4"
												title={remoteSession.sessionId}
											>
												{remoteSession.sessionId}
											</div>
										</div>
									</div>
									<button
										type="button"
										className={`mt-1.5 ${COPY_BUTTON_CLASS}`}
										onClick={copyBridgeConfig}
									>
										{copied ? (
											<Check aria-hidden="true" size={12} />
										) : (
											<Copy aria-hidden="true" size={12} />
										)}
										<span>{copied ? "コピー済み" : "設定をコピー"}</span>
									</button>
								</>
							) : null}
						</Popover.Popup>
					</Popover.Positioner>
				</Popover.Portal>
			</Popover.Root>
			<div className="sr-only" role="status" aria-live="polite">
				{announce}
			</div>
		</>
	);
}
