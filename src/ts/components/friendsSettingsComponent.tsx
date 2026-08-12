import { useMemo, useState, VFC } from "react";
import
{
	DialogButton,
	Field,
	Focusable,
	PanelSection,
	PanelSectionRow,
	TextField,
	ToggleField,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useEmuchievementsState } from "../hooks/achievementsContext";
import { FriendsManager, LinkCandidate } from "../FriendsManager";
import { extractSteamId, getCurrentUserSteamId } from "../friend-utils";
import { FriendLink } from "../settings";
import { format, useTranslations } from "../useTranslations";

const statusColors: Record<string, string> = {
	verified: "#5ba32b",
	unverified: "#d9a441",
};

export const FriendsSettings: VFC = () =>
{
	const t = useTranslations();
	const { settings, managers: { friendsManager } } = useEmuchievementsState();

	// Only holds fields the user has actually edited. Untouched rows fall back to the stored link
	// at render time, so rows that appear after mount (the friends list populates asynchronously)
	// are never shown with an empty box next to a "linked" label - which Save would read as
	// "unlink me".
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [scanning, setScanning] = useState(false);
	const [scanProgress, setScanProgress] = useState<{ done: number, total: number; } | null>(null);
	const [suggestions, setSuggestions] = useState<LinkCandidate[]>([]);
	const [manualSteamId, setManualSteamId] = useState("");
	const [manualUsername, setManualUsername] = useState("");

	const ownSteamId = useMemo(() => getCurrentUserSteamId(), []);
	const rows = friendsManager.getFriendsWithLinks();

	const draftFor = (steamId: string, link: FriendLink | undefined) =>
		drafts[steamId] ?? link?.ra_username ?? "";

	const describeLink = (link: FriendLink | undefined): { text: string, color?: string; } =>
	{
		if (!link) return { text: t("friendsNotLinked") };
		if (link.source === "motto") return { text: t("friendsVerified"), color: statusColors.verified };
		return { text: t("friendsUnverified"), color: statusColors.unverified };
	};

	const saveDraft = async (steamId: string, personaName: string, link: FriendLink | undefined) =>
	{
		const draft = draftFor(steamId, link).trim();

		if (!draft)
		{
			await friendsManager.removeLink(steamId);
			return;
		}

		// Prefer a proven link: if the RA account has published this SteamID64 in its motto,
		// record it as verified rather than as a bare manual entry.
		const status = await friendsManager.verifyCandidate(steamId, draft);

		if (status === "not_found")
		{
			toaster.toast({ title: t("title"), body: format(t("friendsNoSuchUser"), draft) });
			return;
		}

		await friendsManager.setLink(steamId, draft, status === "verified" ? "motto" : "manual", personaName);
		toaster.toast({
			title: t("title"),
			body: status === "verified"
				? format(t("friendsLinkVerified"), draft)
				: format(t("friendsLinkSaved"), draft),
		});
	};

	const addManualLink = async () =>
	{
		const steamId = extractSteamId(manualSteamId.trim());
		if (!steamId)
		{
			toaster.toast({ title: t("title"), body: t("friendsInvalidSteamId") });
			return;
		}

		const username = manualUsername.trim();
		if (!username) return;

		const status = await friendsManager.verifyCandidate(steamId, username);
		if (status === "not_found")
		{
			toaster.toast({ title: t("title"), body: format(t("friendsNoSuchUser"), username) });
			return;
		}

		await friendsManager.setLink(steamId, username, status === "verified" ? "motto" : "manual");
		setManualSteamId("");
		setManualUsername("");
		toaster.toast({
			title: t("title"),
			body: status === "verified"
				? format(t("friendsLinkVerified"), username)
				: format(t("friendsLinkSaved"), username),
		});
	};

	const scan = async () =>
	{
		setScanning(true);
		setSuggestions([]);
		setScanProgress({ done: 0, total: 0 });
		try
		{
			const found = await friendsManager.scanFriends((done, total) => setScanProgress({ done, total }));
			setSuggestions(found.filter((candidate) => candidate.status === "unverified"));

			const verified = found.filter((candidate) => candidate.status === "verified").length;
			// Stringified because `format` drops falsy arguments, which would blank out a zero.
			toaster.toast({
				title: t("title"),
				body: format(t("friendsScanResult"), String(verified), String(found.length - verified)),
			});

			setDrafts((current) => found.reduce((accumulator, candidate) =>
			{
				if (candidate.status === "verified") accumulator[candidate.steamId] = candidate.raUsername;
				return accumulator;
			}, { ...current }));
		} finally
		{
			setScanning(false);
			setScanProgress(null);
		}
	};

	return (<div style={{ marginTop: "40px", height: "calc( 100% - 40px )" }}>
		<PanelSection title={t("settingsFriends")}>
			<PanelSectionRow>
				<ToggleField
					label={t("friendsEnable")}
					description={t("friendsEnableDescription")}
					// Read straight from settings: setEnabled writes and then notifies, which
					// re-renders this component, so a local copy would only go stale.
					checked={settings.friends.enabled}
					onChange={async (checked) => await friendsManager.setEnabled(checked)}
				/>
			</PanelSectionRow>

			<PanelSectionRow>
				<Field label={t("friendsInstructions")} description={
					<div style={{ whiteSpace: "pre-wrap" }}>
						{ownSteamId
							? format(t("friendsInstructionsBody"), FriendsManager.mottoToken(ownSteamId))
							: t("friendsNoSteamId")}
					</div>
				} />
			</PanelSectionRow>

			<PanelSectionRow>
				<Field label={t("friendsPlaytimeNotice")} description={t("friendsPlaytimeNoticeBody")} />
			</PanelSectionRow>
		</PanelSection>

		<PanelSection title={t("friendsLinksTitle")}>
			<PanelSectionRow>
				<Field
					label={scanning
						? (scanProgress
							? format(t("friendsScanning"), String(scanProgress.done), String(scanProgress.total))
							: t("friendsScanning"))
						: t("friendsScan")}
					description={t("friendsScanDescription")}
					onActivate={scanning ? undefined : () => void scan()}
					bottomSeparator="standard"
				/>
			</PanelSectionRow>

			{/* The friend store shape is not guaranteed, so linking must never depend on
			    enumeration succeeding. This row is the fallback that keeps the feature usable. */}
			<PanelSectionRow>
				<Field label={t("friendsAddManual")} description={t("friendsAddManualDescription")}>
					<Focusable style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
						<TextField
							label={t("friendsSteamId")}
							value={manualSteamId}
							onChange={(event) => setManualSteamId(event.target.value)}
						/>
						<TextField
							label={t("friendsRaUsername")}
							value={manualUsername}
							onChange={(event) => setManualUsername(event.target.value)}
						/>
						<DialogButton
							style={{ width: "6rem", minWidth: "6rem" }}
							onClick={() => void addManualLink()}
						>
							{t("friendsAdd")}
						</DialogButton>
					</Focusable>
				</Field>
			</PanelSectionRow>

			{rows.length === 0 && (
				<PanelSectionRow>
					<Field description={t("friendsNoFriends")} />
				</PanelSectionRow>
			)}

			{rows.map(({ friend, link }) =>
			{
				const status = describeLink(link);
				const suggestion = suggestions.find((candidate) => candidate.steamId === friend.steamId);

				return (
					<PanelSectionRow key={friend.steamId}>
						<Field
							label={friend.personaName}
							description={
								<div style={{ color: status.color }}>
									{status.text}
									{suggestion && (
										<div style={{ color: statusColors.unverified }}>
											{format(t("friendsSuggestion"), suggestion.raUsername)}
										</div>
									)}
								</div>
							}
						>
							<Focusable style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
								<TextField
									label={t("friendsRaUsername")}
									value={draftFor(friend.steamId, link)}
									onChange={(event) => setDrafts((current) => ({
										...current,
										[friend.steamId]: event.target.value,
									}))}
								/>
								<DialogButton
									style={{ width: "6rem", minWidth: "6rem" }}
									onClick={() => void saveDraft(friend.steamId, friend.personaName, link)}
								>
									{t("friendsSave")}
								</DialogButton>
							</Focusable>
						</Field>
					</PanelSectionRow>
				);
			})}
		</PanelSection>
	</div>);
};
