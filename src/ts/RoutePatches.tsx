import { RoutePatch, routerHook } from "@decky/api";
import { Mountable } from "./System";
import { EmuchievementsState } from "./hooks/achievementsContext";
import { ReactElement } from "react";

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

export function patchAppPage(_state: EmuchievementsState): Mountable
{
	// @ts-ignore
	return routePatch("/library/app/:appid", (props: { path: string, children: ReactElement; }) =>
	{
		return props;
	});
}