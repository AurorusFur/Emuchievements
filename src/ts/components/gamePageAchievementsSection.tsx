import { Navigation, ProgressBarWithInfo } from "@decky/ui";
import { VFC } from "react";
import { useEmuchievementsState } from "../hooks/achievementsContext";

interface Props
{
	appId: number;
}

export const GamePageAchievementsSection: VFC<Props> = ({ appId }) =>
{
	const { managers: { achievementManager }, settings } = useEmuchievementsState();

	if (!settings.general.game_page) return null;

	const achievements = achievementManager.fetchAchievements(appId);
	const progress = achievementManager.fetchAchievementsProgress(appId);

	if (achievements.user.loading)
	{
		return (
			<div
				style={{
					padding: "12px 16px",
					borderTop: "1px solid rgba(255,255,255,0.1)",
				}}
			>
				<ProgressBarWithInfo
					nProgress={0}
					sOperationText="RetroAchievements"
					sTimeRemaining="Loading..."
					layout="inline"
					bottomSeparator="none"
				/>
			</div>
		);
	}

	if (!progress) return null;

	return (
		<div
			onClick={() => Navigation.Navigate(`/library/app/${appId}/achievements/my/individual`)}
			style={{
				padding: "12px 16px",
				cursor: "pointer",
				borderTop: "1px solid rgba(255,255,255,0.1)",
			}}
		>
			<ProgressBarWithInfo
				nProgress={progress.percentage}
				sOperationText="RetroAchievements"
				sTimeRemaining={`${progress.achieved}/${progress.total}`}
				layout="inline"
				bottomSeparator="none"
			/>
		</div>
	);
};
