import { RoutePatch, routerHook } from "@decky/api";
import { Mountable } from "./System";
import { EmuchievementsState, EmuchievementsStateContextProvider } from "./hooks/achievementsContext";
import { ReactElement } from "react";
import { AchievementPageComponent } from "./components/achievementPageComponent";
import { GamePageAchievementsSection } from "./components/gamePageAchievementsSection";

function routePatch(path: string, patch: RoutePatch): Mountable
{
	return {
		mount()
		{
			routerHook.addPatch(path, patch);
		},
		unMount()
		{
			routerHook.removePatch(path, patch);
		}
	};
}

export function patchAppPage(state: EmuchievementsState): Mountable
{
	// @ts-ignore
	return routePatch("/library/app/:appid", (props: { path: string, children: ReactElement; }) =>
	{
		const match = window.location.href.match(/\/library\/app\/(\d+)/);
		if (!match) return props;
		const appId = parseInt(match[1], 10);

		const overview = appStore.GetAppOverviewByAppID(appId);
		if (!overview || overview.app_type !== 1073741824) return props;

		return {
			...props,
			children: (
				<>
					{props.children}
					<EmuchievementsStateContextProvider emuchievementsState={state}>
						<GamePageAchievementsSection appId={appId} />
					</EmuchievementsStateContextProvider>
				</>
			),
		};
	});
}

export function patchAchievementsPage(state: EmuchievementsState): Mountable
{
	// @ts-ignore
	return routePatch("/library/app/:appid/achievements/my/individual", (props: { path: string, children: ReactElement; }) =>
	{
		const match = window.location.href.match(/\/library\/app\/(\d+)/);
		if (!match) return props;
		const appId = parseInt(match[1], 10);

		const overview = appStore.GetAppOverviewByAppID(appId);
		if (!overview || overview.app_type !== 1073741824) return props;

		return {
			...props,
			children: (
				<EmuchievementsStateContextProvider emuchievementsState={state}>
					<AchievementPageComponent appId={appId} />
				</EmuchievementsStateContextProvider>
			),
		};
	});
}
