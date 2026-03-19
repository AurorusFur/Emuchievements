import {Mutex} from "async-mutex";
import {findInTree} from "@decky/ui";
import { call, toaster } from "@decky/api";
import {EmuchievementsState} from "./hooks/achievementsContext";
import Logger from "./logger";
import {getTranslateFunc} from "./useTranslations";

export type SettingsData = {
	retroachievements: RetroAchievementsData,
	cache: CacheData,
	general: GeneralData,
	config_version: string
};

export type RetroAchievementsData = {
	username: string,
	api_key: string,
	logged_in?: boolean,
};

export type CustomIdsOverrides = {
	/**
	 * Game name
	 */
	name: string | null,
	/**
	 * RetroAchievements supported game files hash.
	 * Can be found on URL: `https://retroachievements.org/game/xyz/hashes` where `xyz` is Game ID
	 */
	hash?: string | null,
	/**
	 * RetroAchievement Game ID.
	 */
	retro_achivement_game_id: number | null,
}

export type CacheData = {
	ids: Record<number, number | null>,
	custom_ids_overrides: Record<number, CustomIdsOverrides>,
};

export type GeneralData = {
	game_page: boolean,
	store_category: boolean,
	/**
	 * Enabled or disable showing prefixes like `[ACHIEVED]` & `[NOT ACHIEVED]`
	 */
	show_achieved_state_prefixes: boolean,
};

export const CONFIG_VERSION = "1.1.0";

const DEFAULT_CONFIG: SettingsData = {
	config_version: CONFIG_VERSION,
	retroachievements: {
		username: "",
		api_key: "",
	},
	cache: {
		ids: {},
		custom_ids_overrides: {},
	},
	general: {
		game_page: true,
		store_category: true,
		show_achieved_state_prefixes: true,
	},
};


const findOldConfigKey = (config: any, search: string): any =>
{
	return findInTree(config, (x: any) =>
		   {
			   if (typeof x == "object")
			   {
				   for (let key in x)
				   {
					   if (key == search)
					   {
						   return true
					   }
				   }
			   }
			   return false
		   }
		   , {})[search];
}

export class Settings
{
	private readonly state: EmuchievementsState;
	private readonly logger: Logger = new Logger("Settings");
	private readonly mutex: Mutex = new Mutex();
	private readonly packet_size: number = 2048;
	data: SettingsData = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

	get retroachievements(): RetroAchievementsData
	{
		return this.get("retroachievements");
	}

	set retroachievements(retroachievements: RetroAchievementsData)
	{
		this.set("retroachievements", retroachievements);
	}

	get general(): GeneralData
	{
		return this.get("general");
	}

	set general(general: GeneralData)
	{
		this.set("general", general);
	}

	get cache(): CacheData
	{
		return this.get("cache");
	}

	set cache(cache: CacheData)
	{
		this.set("cache", cache);
	}


	constructor(state: EmuchievementsState)
	{
		this.state = state;
	}

	set<T extends keyof SettingsData>(key: T, value: SettingsData[T])
	{
		if (this.data.hasOwnProperty(key))
		{
			this.data[key] = value;
			void this.writeSettings();
		}
		this.state.notifyUpdate();
		return this;
	}

	setMultiple(settings: SettingsData)
	{
		(Object.keys(settings) as (keyof SettingsData)[]).forEach((key: keyof SettingsData) =>
		{
			this.set(key, settings[key]);
		});
		return this;
	}

	get<T extends keyof SettingsData>(key: T): SettingsData[T]
	{
		return this.data[key];
	}

	async readSettings(): Promise<void>
	{
		toaster.toast({ title: "DBG readSettings", body: "called" });
		let needsWrite = false;
		const release = await this.mutex.acquire();
		try
		{
			let buffer = "";
			let length: number;
			try { length = await call<[number], number>("start_read_config", this.packet_size); } catch(e: any) { toaster.toast({ title: "DBG readSettings", body: `${e?.pythonTraceback ?? e?.message ?? String(e)}`.substring(0, 200) }); throw e; }
			for (let i = 0; i < length; i++)
			{
				buffer += await call<[number], string>("read_config", i);
			}
			this.logger.debug("readSettings", buffer);
			toaster.toast({ title: "DBG readSettings", body: `bufLen=${buffer.length} buf0="${buffer.substring(0,50)}"` });
			let data: SettingsData;
			try { data = JSON.parse(buffer); } catch(e: any) { toaster.toast({ title: "DBG readSettings", body: `JSON.parse error: ${e.message}` }); throw e; }
			toaster.toast({ title: "DBG readSettings", body: `ver=${data.config_version} logged_in=${(data.retroachievements as any)?.logged_in} user="${data.retroachievements?.username}"` });
			if (data.config_version !== CONFIG_VERSION)
			{
				const t = getTranslateFunc();
				toaster.toast({
					title: t("title"),
					body: t("settingsReset")
				});

				const username: string = findOldConfigKey(data, "username")
				const api_key: string = findOldConfigKey(data, "api_key")

				this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

				this.data.retroachievements.username = username
				this.data.retroachievements.api_key = api_key

				needsWrite = true;
			} else
			{
				this.data = data;
			}
		} finally
		{
			release();
		}
		if (needsWrite) await this.writeSettings();
	}

	async writeSettings(): Promise<void>
	{
		const release = await this.mutex.acquire();
		try
		{
			const buffer = JSON.stringify(this.data, undefined, "\t");
			toaster.toast({ title: "DBG writeSettings", body: `logged_in=${this.data.retroachievements.logged_in} user="${this.data.retroachievements.username}"` });
			const length = Math.ceil(buffer.length / this.packet_size);
			await call<[number, number], void>("start_write_config", length, this.packet_size);
			for (let i = 0; i < length; i++)
			{
				const data = buffer.slice(i * this.packet_size, (i + 1) * this.packet_size);
				await call<[number, string], void>("write_config", i, data);
			}
		} finally
		{
			release();
		}
	}
}