import { call, fetchNoCors } from "@decky/api";
import { createContext, FC, ReactNode, useContext, useEffect, useState } from "react";
import { AchievementManager, Manager } from "../AchievementsManager";
import { getAllNonSteamAppOverview } from "../steam-utils";
import { Promise } from "bluebird";
import { Settings } from "../settings";
import { getTranslateFunc } from "../useTranslations";

interface Login
{
	username: string,
	api_key: string;
}

export interface LoadingData
{
	get percentage(): number;
	get globalLoading(): boolean;
	set globalLoading(value: boolean);
	get errored(): boolean;
	set errored(value: boolean);
	get game(): string;
	set game(value: string);
	get description(): string;
	set description(value: string);
	get processed(): number;
	set processed(value: number);
	get total(): number;
	set total(value: number);
	get fetching(): boolean;
	set fetching(value: boolean);
}

interface Managers
{
	achievementManager: AchievementManager;
}

interface EmuchievementsStateContext
{
	loadingData: LoadingData,
	managers: Managers,
	apps: Promise<number[]>,
	settings: Settings,
	loggedIn: Promise<boolean>,
	refresh(): Promise<void>,
	login(login: Login): Promise<boolean>;
}


export class EmuchievementsState
{
	private _loadingData: LoadingData = new class implements LoadingData
	{
		private t = getTranslateFunc();
		private state: EmuchievementsState;

		constructor(outer: EmuchievementsState)
		{
			this.state = outer;
		}

		get percentage(): number
		{
			return (this.processed / this.total) * 100;
		}

		private _globalLoading = false;

		get globalLoading(): boolean
		{
			return this._globalLoading;
		}

		set globalLoading(value: boolean)
		{
			this._globalLoading = value;
			this.state.notifyUpdate();
		}

		private _errored = false;

		get errored(): boolean
		{
			return this._errored;
		}

		set errored(value: boolean)
		{
			this._errored = value;
			this.state.notifyUpdate();
		}

		private _total = 0;

		get total(): number
		{
			return this._total;
		}

		set total(value: number)
		{
			this._total = value;
			this.state.notifyUpdate();
		}

		private _processed = 0;

		get processed(): number
		{
			return this._processed;
		}

		set processed(value: number)
		{
			this._processed = value;
			this.state.notifyUpdate();
		}

		private _game = this.t("fetching");

		get game(): string
		{
			return this._game;
		}

		set game(value: string)
		{
			this._game = value;
			this.state.notifyUpdate();
		}

		private _description = "";

		get description(): string
		{
			return this._description;
		}

		set description(value: string)
		{
			this._description = value;
			this.state.notifyUpdate();
		}

		private _fetching = true;

		get fetching(): boolean
		{
			return this._fetching;
		}

		set fetching(value: boolean)
		{
			this._fetching = value;
			this.state.notifyUpdate();
		}
	}(this);

	private readonly _settings;

	constructor()
	{
		this._settings = new Settings(this);
	}

	private readonly _managers: Managers = {
		achievementManager: new AchievementManager(this)
	};

	public eventBus = new EventTarget();

	get state(): EmuchievementsStateContext
	{
		return {
			loadingData: this.loadingData,
			managers: this.managers,
			apps: this.apps,
			settings: this.settings,
			loggedIn: this.loggedIn,
			refresh: () => this.refresh(),
			login: (login: Login) => this.login(login),
		};
	}

	get managers(): Managers
	{
		return this._managers;
	}

	get loadingData(): LoadingData
	{
		return this._loadingData;
	}

	get apps(): Promise<number[]>
	{
		return (async () =>
			[... new Set((await getAllNonSteamAppOverview()))]
				.sort((a, b) =>
				{
					if (a.display_name < b.display_name)
					{
						return -1;
					}
					if (a.display_name > b.display_name)
					{
						return 1;
					}
					return 0;
				})
				.map((overview) => overview.appid)
				.filter((appId) => this._managers.achievementManager.isReady(appId))
		)();
	}

	get settings(): Settings
	{
		return this._settings;
	}
	private _login: boolean = false;
	get loggedIn(): Promise<boolean>
	{
		return (async () =>
		{
			if (this._login === true) return true;
			const { logged_in, username, api_key } = this.settings.retroachievements;
			if (logged_in && username && api_key)
			{
				this._login = true;
				return true;
			}
			const url = `https://retroachievements.org/API/API_GetAchievementOfTheWeek.php?z=${username}&y=${api_key}`;
			try
			{
				const authenticated = await fetchNoCors(url);
				if (authenticated.ok)
				{
					const body = await authenticated.text();
					this._login = !body.includes("Invalid API Key");
					this.settings.retroachievements.logged_in = this._login;
					if (this._login) await this.settings.writeSettings();
					return this._login;
				}
			} catch (e: any) {
			}
			return false;
		})();
	}

	async init(): Promise<void>
	{
		Promise.map(Object.values(this._managers), (async (manager: Manager) =>
		{
			await manager.init();
		})).then(() =>
		{
			this.notifyUpdate();
		});
	}

	async deinit(): Promise<void>
	{
		Promise.map(Object.values(this._managers), (async (manager: Manager) =>
		{
			await manager.deinit();
		})).then(() =>
		{
			this.notifyUpdate();
		});
		await call("reset");

	}

	async refresh(): Promise<void>
	{
		Promise.map(Object.values(this._managers), (async (manager: Manager) =>
		{
			await manager.refresh();
		})).then(() =>
		{
			this.notifyUpdate();
		});
	}

	async login({ username, api_key }: Login): Promise<boolean>
	{
		this._login = false;
		this.settings.retroachievements.logged_in = false;
		this.settings.retroachievements.username = username;
		this.settings.retroachievements.api_key = api_key;
		return this.loggedIn;
	}

	notifyUpdate(): void
	{
		this.eventBus.dispatchEvent(new Event('update'));
	}
}

export const EmuchievementsStateContext = createContext<EmuchievementsStateContext>(null as any);

export const useEmuchievementsState = () => useContext(EmuchievementsStateContext);

interface Props
{
	emuchievementsState: EmuchievementsState;
}

export const EmuchievementsStateContextProvider: FC<Props> = ({ children, emuchievementsState }) =>
{
	const [publicEmuchievementsState, setPublicEmuchievementsState] = useState<EmuchievementsStateContext>({ ...emuchievementsState.state });

	useEffect(() =>
	{
		function onUpdate()
		{
			setPublicEmuchievementsState({ ...emuchievementsState.state });
		}

		emuchievementsState.eventBus.addEventListener('update', onUpdate);

		return () => emuchievementsState.eventBus.removeEventListener('update', onUpdate);
	}, []);


	return (
		<EmuchievementsStateContext.Provider
			value={{ ...publicEmuchievementsState }}
		>
			{children}
		</EmuchievementsStateContext.Provider>
	);
};

export const EmuchievementsStateContextConsumer: FC<{ children: (value: EmuchievementsStateContext) => ReactNode; }> = ({ children }) =>
{
	return <EmuchievementsStateContext.Consumer>
		{children}
	</EmuchievementsStateContext.Consumer>;
};