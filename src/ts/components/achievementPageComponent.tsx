import { Focusable, ProgressBarWithInfo } from "@decky/ui";
import { VFC } from "react";
import { useEmuchievementsState } from "../hooks/achievementsContext";
import { SteamAppAchievement } from "../SteamTypes";

interface AchievementItemProps
{
	achievement: SteamAppAchievement;
}

const AchievementItem: VFC<AchievementItemProps> = ({ achievement }) =>
{
	const unlockDate = achievement.bAchieved && achievement.rtUnlocked
		? new Date(achievement.rtUnlocked * 1000).toLocaleDateString()
		: null;

	return (
		<div style={{
			display: "flex",
			flexDirection: "row",
			gap: "12px",
			padding: "10px 12px",
			alignItems: "center",
			opacity: achievement.bAchieved ? 1 : 0.5,
			borderBottom: "1px solid rgba(255,255,255,0.05)",
		}}>
			<img
				src={achievement.strImage}
				style={{ width: "48px", height: "48px", borderRadius: "4px", flexShrink: 0 }}
			/>
			<div style={{ flex: 1, minWidth: 0 }}>
				<div style={{ fontWeight: "bold", fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
					{achievement.strName}
				</div>
				<div style={{ fontSize: "12px", opacity: 0.7, marginTop: "2px" }}>
					{achievement.strDescription}
				</div>
				{unlockDate &&
					<div style={{ fontSize: "11px", opacity: 0.45, marginTop: "2px" }}>
						Unlocked: {unlockDate}
					</div>
				}
			</div>
			<div style={{ fontSize: "11px", opacity: 0.45, flexShrink: 0 }}>
				{Math.round(achievement.flAchieved)}%
			</div>
		</div>
	);
};

interface AchievementPageComponentProps
{
	appId: number;
}

export const AchievementPageComponent: VFC<AchievementPageComponentProps> = ({ appId }) =>
{
	const { managers: { achievementManager } } = useEmuchievementsState();
	const achievements = achievementManager.fetchAchievements(appId);

	if (achievements.user.loading)
	{
		return (
			<div style={{ padding: "40px 16px" }}>
				<ProgressBarWithInfo
					label="Loading achievements..."
					indeterminate
					layout="inline"
					bottomSeparator="none"
				/>
			</div>
		);
	}

	if (!achievements.user.data)
	{
		return (
			<div style={{ padding: "40px 16px", textAlign: "center", opacity: 0.6 }}>
				No RetroAchievements found for this game.
			</div>
		);
	}

	const achieved = Object.values(achievements.user.data.achieved) as SteamAppAchievement[];
	const unachieved = Object.values(achievements.user.data.unachieved) as SteamAppAchievement[];
	const total = achieved.length + unachieved.length;

	return (
		<Focusable style={{
			display: "flex",
			flexDirection: "column",
			height: "100%",
			overflowY: "auto",
		}}>
			<div style={{
				padding: "16px",
				fontSize: "13px",
				opacity: 0.7,
				borderBottom: "1px solid rgba(255,255,255,0.1)",
				flexShrink: 0,
			}}>
				{achieved.length} of {total} achievements earned
			</div>
			<div style={{ overflowY: "auto", flex: 1 }}>
				{achieved.map(a => <AchievementItem key={a.strID} achievement={a} />)}
				{unachieved.map(a => <AchievementItem key={a.strID} achievement={a} />)}
			</div>
		</Focusable>
	);
};
