import {
	type Icon,
	Selection,
	Square,
	SquaresFour,
} from "@phosphor-icons/react";
import type { BootstrapResult } from "@/features/billing/model/types";
import type {
	CloudProjectRevisionSummary,
	CloudProjectStorageDeniedResult,
} from "@/features/cloud-projects/model/api";
import type {
	ActiveCloudProject,
	EditorCloudSaveFailureReason,
	EditorCloudSaveStatus,
} from "@/features/cloud-projects/model/editor-cloud-project-store";
import type {
	ImportIssue,
	ImportIssueGroup,
} from "@/features/import/model/types";
import { type ActionShortcut, shortcutLabel } from "@/shared/actions";
import type { TopBarArtboardScopeMode } from "./artboard-scope";
import {
	compactExportReportSourcePath,
	type ExportReportModel,
} from "./export-report";
import type { TopBarImportReportModel } from "./import-report";

export type ReportStatus =
	| TopBarImportReportModel["status"]
	| ExportReportModel["status"];

export type ReportIssueSeverity =
	| ImportIssue["severity"]
	| ExportReportModel["issues"][number]["severity"];

export type CloudProjectNotice = {
	readonly status: ReportStatus;
	readonly title: string;
	readonly detail?: string;
};

export type VersionHistoryState =
	| { readonly status: "idle" | "loading" }
	| {
			readonly status: "loaded";
			readonly revisions: readonly CloudProjectRevisionSummary[];
	  }
	| { readonly status: "error"; readonly message: string };

export type CloudAccountAccessTone = "accent" | "warning" | "danger" | "muted";
export type CloudAccountAccessKind =
	| "checking"
	| "enabled"
	| "sign-in-required"
	| "creator-required"
	| "unknown";

export type CloudAccountAccess = {
	readonly kind: CloudAccountAccessKind;
	readonly tone: CloudAccountAccessTone;
	readonly label: string;
	readonly detail: string;
};

export const scopeButtonIcon = (mode: TopBarArtboardScopeMode): Icon => {
	if (mode === "current") return Square;
	if (mode === "selected") return Selection;
	return SquaresFour;
};

export const scopeButtonTitle = (
	mode: TopBarArtboardScopeMode,
	selectedArtboardCount: number,
): string => {
	if (mode === "current") return "Export current artboard";
	if (mode === "all") return "Export all artboards";
	return `Export selected artboards (${selectedArtboardCount})`;
};

export const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
	const mb = kb / 1024;
	return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
};

export const formatTimestamp = (value: string): string => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

export const cloudStatusLabel = (
	status: EditorCloudSaveStatus,
	activeProject: ActiveCloudProject | null,
	failureReason?: EditorCloudSaveFailureReason | null,
): string => {
	if (status === "saving") return "Saving";
	if (!activeProject) return "Local";
	if (status === "dirty") return "Unsaved";
	if (status === "failed" && failureReason === "project-not-found")
		return "Stale";
	if (status === "failed") return "Failed";
	if (status === "conflict") return "Conflict";
	return "Saved";
};

export const cloudStatusClass = (status: EditorCloudSaveStatus): string => {
	if (status === "saved") return "text-accent-fg";
	if (status === "dirty" || status === "saving") return "text-warn-fg";
	if (status === "failed" || status === "conflict") return "text-danger-fg";
	return "text-fg-muted";
};

export const cloudProjectUpgradeDetail = (
	result: CloudProjectStorageDeniedResult,
): string =>
	`${result.message} Keep editing locally; export remains available.`;

export const cloudLocationLabel = (
	activeProject: ActiveCloudProject | null,
): string => (activeProject ? activeProject.name : "Local document");

export const cloudLocationDetail = (
	activeProject: ActiveCloudProject | null,
): string =>
	activeProject
		? `Cloud project · r${activeProject.revision}`
		: "Stored in this browser";

export const cloudSaveStateLabel = (
	status: EditorCloudSaveStatus,
	activeProject: ActiveCloudProject | null,
	failureReason?: EditorCloudSaveFailureReason | null,
): string => {
	if (status === "saving") return "Saving";
	if (!activeProject) return "Local only";
	if (status === "dirty") return "Unsaved changes";
	if (status === "failed" && failureReason === "project-not-found")
		return "Project unavailable";
	if (status === "failed") return "Save failed";
	if (status === "conflict") return "Needs review";
	return "Saved";
};

export const cloudSaveStateDetail = (
	status: EditorCloudSaveStatus,
	activeProject: ActiveCloudProject | null,
	failureReason?: EditorCloudSaveFailureReason | null,
): string => {
	if (status === "saving") return "Writing the current document.";
	if (!activeProject) return "Cloud is optional; local work remains open.";
	if (status === "dirty") return "Autosave is pending; save now anytime.";
	if (status === "failed" && failureReason === "project-not-found") {
		return "The cloud link is stale; this document is still local.";
	}
	if (status === "failed") return "Keep working locally; retry when ready.";
	if (status === "conflict") return "Cloud has a newer revision.";
	return "Version history can restore earlier revisions.";
};

export const cloudTriggerActionLabel = (
	status: EditorCloudSaveStatus,
	activeProject: ActiveCloudProject | null,
	failureReason?: EditorCloudSaveFailureReason | null,
): string => {
	if (status === "saving") return "Saving";
	if (!activeProject) return "Save to cloud";
	if (status === "dirty") return "Save now";
	if (status === "failed" && failureReason === "project-not-found")
		return "Reconnect cloud";
	if (status === "failed") return "Save failed";
	if (status === "conflict") return "Resolve";
	return "Saved";
};

export const cloudTriggerToneClass = (
	status: EditorCloudSaveStatus,
	activeProject: ActiveCloudProject | null,
): string => {
	if (status === "failed" || status === "conflict") {
		return "border-danger/35 bg-danger-surface/45 text-danger-fg hover:border-danger/55 hover:bg-danger-surface/70 hover:text-danger-fg focus-visible:outline-danger/60";
	}
	if (status === "dirty" || status === "saving") {
		return "border-warn/35 bg-warn-surface/45 text-warn-fg hover:border-warn/55 hover:bg-warn-surface/70 hover:text-warn-fg focus-visible:outline-warn/60";
	}
	if (activeProject) {
		return "border-accent/35 bg-accent-surface/35 text-accent-fg hover:border-accent/55 hover:bg-accent-surface/55 hover:text-accent-fg focus-visible:outline-accent/60";
	}
	return "border-hairline/18 bg-surface-raised/94 text-fg hover:border-accent/40 hover:bg-surface-raised hover:text-accent-fg focus-visible:outline-accent/60";
};

export const cloudPrimaryActionLabel = (
	status: EditorCloudSaveStatus,
	activeProject: ActiveCloudProject | null,
	failureReason?: EditorCloudSaveFailureReason | null,
): string => {
	if (status === "conflict") return "Save as cloud copy";
	if (status === "failed" && failureReason === "project-not-found") {
		return "Save as new cloud project";
	}
	if (status === "failed") return "Retry cloud save";
	if (!activeProject) return "Save to cloud";
	if (status === "saved") return "Version history";
	return "Save now";
};

export const cloudPrimaryActionDetail = (
	status: EditorCloudSaveStatus,
	activeProject: ActiveCloudProject | null,
	failureReason?: EditorCloudSaveFailureReason | null,
): string => {
	if (status === "conflict") return "Keep current work in a new cloud project";
	if (status === "failed" && failureReason === "project-not-found") {
		return "Creates a fresh project from this document";
	}
	if (status === "failed") return "Try saving without leaving the editor";
	if (!activeProject) return "Attach this local document to your account";
	if (status === "saved") return "Open or restore saved revisions";
	return "Update the attached cloud project";
};

export const cloudPrimaryActionLabelForAccess = (
	status: EditorCloudSaveStatus,
	activeProject: ActiveCloudProject | null,
	access: CloudAccountAccess,
	failureReason?: EditorCloudSaveFailureReason | null,
): string => {
	if (access.kind === "checking") {
		return "Checking cloud access";
	}
	if (access.kind === "sign-in-required") {
		return "Sign in";
	}
	if (access.kind === "creator-required") {
		return "Manage plan";
	}
	return cloudPrimaryActionLabel(status, activeProject, failureReason);
};

export const cloudPrimaryActionDetailForAccess = (
	status: EditorCloudSaveStatus,
	activeProject: ActiveCloudProject | null,
	access: CloudAccountAccess,
	failureReason?: EditorCloudSaveFailureReason | null,
): string => {
	if (access.kind === "checking") {
		return "Local work is available now.";
	}
	if (access.kind === "sign-in-required") {
		return "Cloud saves require an account.";
	}
	if (access.kind === "creator-required") {
		return "Cloud saves require Creator.";
	}
	return cloudPrimaryActionDetail(status, activeProject, failureReason);
};

export const cloudPrimaryIconClass = (access: CloudAccountAccess): string =>
	access.kind === "checking"
		? "text-fg-muted"
		: access.kind === "sign-in-required" || access.kind === "creator-required"
			? "text-warn-fg"
			: "text-accent-fg";

export const cloudFlowTitle = (
	status: EditorCloudSaveStatus,
	activeProject: ActiveCloudProject | null,
	failureReason?: EditorCloudSaveFailureReason | null,
): string => {
	if (!activeProject) return "Local document";
	if (status === "conflict") return "Resolve cloud conflict";
	if (status === "failed" && failureReason === "project-not-found") {
		return "Reconnect cloud save";
	}
	if (status === "failed") return "Recover cloud save";
	if (status === "dirty") return "Cloud project has changes";
	if (status === "saving") return "Saving cloud project";
	return "Saved to cloud";
};

export const cloudFlowDetail = (
	status: EditorCloudSaveStatus,
	activeProject: ActiveCloudProject | null,
	failureReason?: EditorCloudSaveFailureReason | null,
): string => {
	if (!activeProject) return "Work locally or attach to cloud.";
	if (status === "conflict") {
		return "Keep this work, open the latest revision, or work locally.";
	}
	if (status === "failed" && failureReason === "project-not-found") {
		return "The cloud project is unavailable; this document is still local.";
	}
	if (status === "failed") {
		return "Retry cloud save or continue locally.";
	}
	if (status === "dirty") return "Autosave is pending; save now if needed.";
	if (status === "saving") return "The current document is being saved.";
	return activeProject
		? `${activeProject.name} · r${activeProject.revision}`
		: "Saved to cloud.";
};

export const cloudPrimaryItemClass = (access: CloudAccountAccess): string => {
	if (access.kind === "checking") {
		return "grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-hairline/12 bg-surface-sunken/45 px-1.5 py-1.5 text-left text-ui leading-3 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/55 disabled:cursor-wait disabled:opacity-70";
	}
	if (
		access.kind === "sign-in-required" ||
		access.kind === "creator-required"
	) {
		return "grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-warn/35 bg-warn-surface/30 px-1.5 py-1.5 text-left text-ui leading-3 hover:bg-warn-surface/45 focus-visible:outline focus-visible:outline-1 focus-visible:outline-warn/60 disabled:cursor-not-allowed disabled:opacity-45";
	}
	return "grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-accent/30 bg-accent-surface/35 px-1.5 py-1.5 text-left text-ui leading-3 hover:bg-accent-surface/50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent/60 disabled:cursor-not-allowed disabled:opacity-45";
};

export const cloudAccountAccessFromBootstrap = (
	result: BootstrapResult,
): CloudAccountAccess => {
	if (result.kind === "unauthenticated") {
		return {
			kind: "sign-in-required",
			tone: "warning",
			label: "Account required for cloud saves",
			detail: "Editing and export stay open.",
		};
	}
	if (result.kind === "error") {
		return {
			kind: "unknown",
			tone: "muted",
			label: "Cloud account status unavailable",
			detail: "The server will still check saves.",
		};
	}
	if (result.bootstrap.entitlements.features.cloudProjectStorage) {
		return {
			kind: "enabled",
			tone: "accent",
			label: "Cloud saves enabled",
			detail: result.bootstrap.workspace.displayName,
		};
	}
	return {
		kind: "creator-required",
		tone: "warning",
		label: "Cloud saves require Creator",
		detail: "Existing projects can still be opened.",
	};
};

export const cloudAccountAccessClass = (
	tone: CloudAccountAccessTone,
): string => {
	if (tone === "accent") return "border-accent/30 text-accent-fg";
	if (tone === "warning") return "border-warn/35 text-warn-fg";
	if (tone === "danger") return "border-danger/35 text-danger-fg";
	return "border-hairline/12 text-fg-muted";
};

export const reportToneClass = (status: ReportStatus): string => {
	if (status === "success") return "border-accent/35 text-accent-fg";
	if (status === "warning") return "border-warn/35 text-warn-fg";
	return "border-danger/35 text-danger-fg";
};

export const issueSeverityClass = (severity: ReportIssueSeverity): string => {
	if (severity === "error") return "border-danger/35 text-danger-fg";
	if (severity === "warning") return "border-warn/35 text-warn-fg";
	return "border-accent/30 text-accent-fg";
};

export const issueCategoryClass = (category: string): string => {
	if (category === "unsupported" || category === "invalid") {
		return "border-danger/35 bg-danger-surface text-danger-fg";
	}
	if (category === "rasterized" || category === "fallback") {
		return "border-warn/35 bg-warn-surface text-warn-fg";
	}
	if (category === "approximated" || category === "preserved") {
		return "border-accent/30 bg-accent-surface text-accent-fg";
	}
	return "border-white/10 bg-white/[0.035] text-fg-muted";
};

export const issueCategoryLabel = (category: string): string => {
	if (category === "approximated") return "approx";
	if (category === "rasterized") return "raster";
	if (category === "unsupported") return "unsup";
	if (category === "preserved") return "kept";
	return category;
};

export const compactList = (values: readonly string[], limit = 2): string => {
	const visible = values.slice(0, limit).join(", ");
	const hidden = values.length - limit;
	return hidden > 0 ? `${visible} +${hidden}` : visible;
};

export const buttonShortcutLabel = (
	label: string,
	shortcut: ActionShortcut,
): string => `${label} (${shortcutLabel(shortcut)})`;

export type ReportTargetLike = {
	readonly kind: string;
	readonly id: string;
	readonly label?: string;
	readonly role?: string;
	readonly source?: string;
	readonly ref?: string;
	readonly path?: string;
};

export type CompactIssueGroup =
	| ImportIssueGroup
	| ExportReportModel["issueGroups"][number];

export const compactTargets = (
	targets: readonly ReportTargetLike[],
	limit = 2,
): { readonly label: string; readonly title: string } | null => {
	if (targets.length === 0) return null;
	const titleForTarget = (target: ReportTargetLike): string => {
		const id = target.label ?? target.id;
		return `${target.kind}:${id}`;
	};
	const labelForTarget = (target: ReportTargetLike): string => {
		const id = target.label ?? target.id;
		const compactId =
			target.kind === "source" ? compactExportReportSourcePath(id) : id;
		return `${target.kind}:${compactId}`;
	};
	const visible = targets.slice(0, limit).map(labelForTarget).join(", ");
	const hidden = targets.length - limit;
	const countLabel = `${targets.length} target${targets.length === 1 ? "" : "s"}`;
	return {
		label: `${countLabel}: ${hidden > 0 ? `${visible} +${hidden}` : visible}`,
		title: targets
			.map((target) => {
				const locator = [
					target.role ? `role:${target.role}` : null,
					target.source ? `source:${target.source}` : null,
					target.ref ? `ref:${target.ref}` : null,
					target.path ? `path:${target.path}` : null,
				]
					.filter(Boolean)
					.join(" ");
				return `${titleForTarget(target)}${locator ? ` (${locator})` : ""}`;
			})
			.join(", "),
	};
};
