import React, { VFC } from "react";
import { Field, Focusable, Navigation, PanelSectionRow } from "@decky/ui";
import { useEmuchievementsState } from "../hooks/achievementsContext";
import { FriendActivity } from "../FriendsManager";
import { format, useTranslations } from "../useTranslations";

function relativeTime(timestamp: number, t: ReturnType<typeof useTranslations>): string
{
	if (!timestamp) return "";

	const minutes = Math.floor((Date.now() - timestamp) / 60000);
	if (minutes < 1) return t("friendsJustNow");
	if (minutes < 60) return format(t("friendsMinutesAgo"), minutes);

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return format(t("friendsHoursAgo"), hours);

	return format(t("friendsDaysAgo"), Math.floor(hours / 24));
}

const FriendActivityRow: VFC<{ activity: FriendActivity; }> = ({ activity }) =>
{
	const t = useTranslations();
	const { managers: { friendsManager } } = useEmuchievementsState();

	const latest = activity.recentAchievements[0];
	const appId = friendsManager.getAppIdForGameId(activity.lastGameId);

	// Rich presence is live state and outranks a historic unlock; without either there is
	// nothing worth a row.
	const headline = activity.richPresenceMsg
		?? (latest ? format(t("friendsUnlocked"), latest.title, latest.gameTitle) : null);

	if (!headline && !activity.error) return null;

	const subtitle = activity.error
		? t("friendsUnreachable")
		: [
			latest && !activity.richPresenceMsg ? relativeTime(latest.unlockedAt, t) : null,
			activity.richPresenceMsg && latest
				? format(t("friendsLastUnlock"), latest.title, relativeTime(latest.unlockedAt, t))
				: null,
		].filter(Boolean).join(" · ");

	return (
		<PanelSectionRow>
			<Field
				label={activity.personaName}
				description={
					<div>
						<div>{headline ?? t("friendsUnreachable")}</div>
						{subtitle && <div style={{ opacity: 0.7, fontSize: "0.8em" }}>{subtitle}</div>}
					</div>
				}
				// Only navigable when the friend's game exists in this library as a bound shortcut.
				onActivate={appId !== null ? () =>
				{
					Navigation.Navigate(`/library/app/${appId}/achievements/my/individual`);
					Navigation.CloseSideMenus();
				} : undefined}
			>
				{activity.userPic && (
					<Focusable style={{ display: "flex", justifyContent: "flex-end" }}>
						<img
							src={activity.userPic}
							alt=""
							style={{ width: "32px", height: "32px", borderRadius: "4px" }}
						/>
					</Focusable>
				)}
			</Field>
		</PanelSectionRow>
	);
};

export const FriendActivityList: VFC = () =>
{
	const t = useTranslations();
	const { settings, managers: { friendsManager } } = useEmuchievementsState();

	if (!settings.friends.enabled) return null;

	const activity = friendsManager.getActivity();

	if (activity.length === 0)
	{
		return (
			<PanelSectionRow>
				<Field description={
					friendsManager.getLinks().length === 0 ? t("friendsNoLinks") : t("friendsNoActivity")
				} />
			</PanelSectionRow>
		);
	}

	return <>
		{activity.map((entry) => <FriendActivityRow key={entry.steamId} activity={entry} />)}
	</>;
};
