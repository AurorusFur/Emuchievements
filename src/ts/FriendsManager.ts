import { fetchNoCors } from "@decky/api";
import { GetUserProfileResponse, GetUserRecentAchievementsResponse } from "@retroachievements/api";
import { Manager } from "./AchievementsManager";
import { EmuchievementsState } from "./hooks/achievementsContext";
import { FriendLink, FriendLinkSource } from "./settings";
import { getSteamFriends, SteamFriend } from "./friend-utils";
import Logger from "./logger";

/**
 * A single achievement a linked friend unlocked recently.
 */
export interface FriendAchievement
{
	achievementId: number;
	title: string;
	description: string;
	points: number;
	badgeUrl: string;
	gameId: number;
	gameTitle: string;
	hardcore: boolean;
	/**
	 * Unlock time in epoch milliseconds.
	 */
	unlockedAt: number;
}

export interface FriendActivity
{
	steamId: string;
	raUsername: string;
	personaName: string;
	userPic: string | null;
	/**
	 * RetroAchievements' own presence string, e.g. "Playing Super Metroid, 41% complete".
	 * Null when the friend is not currently in a game RA knows about.
	 */
	richPresenceMsg: string | null;
	/**
	 * RetroAchievements game id the friend last played, not a Steam appid.
	 * Resolve it with `getAppIdForGameId` to reach a local library entry.
	 */
	lastGameId: number | null;
	recentAchievements: FriendAchievement[];
	/**
	 * Epoch milliseconds of the last successful poll.
	 */
	updatedAt: number;
	error?: string;
}

export type LinkCandidateStatus =
	/** Motto on the RA profile contains this friend's SteamID64 - the association is proven. */
	| "verified"
	/** An RA account with this name exists, but it has not claimed this SteamID64. */
	| "unverified"
	/** No RetroAchievements account by that name. */
	| "not_found";

export interface LinkCandidate
{
	steamId: string;
	personaName: string;
	raUsername: string;
	status: LinkCandidateStatus;
}

const RA_API = "https://retroachievements.org/API";

/**
 * RetroAchievements usernames are alphanumeric plus underscore. Anything else cannot be a
 * username, so it is not worth an API call.
 */
const RA_USERNAME_PATTERN = /^[A-Za-z0-9_]{2,20}$/;

const STEAMID64_PATTERN = /\b7656\d{13}\b/g;

/**
 * Watches RetroAchievements activity for Steam friends whose RA account is known.
 *
 * The RetroAchievements API is world-readable with the local user's own key, so once a friend's
 * RA username is known no cooperation is needed to read their activity. That makes the whole
 * feature hinge on one thing: a SteamID64 -> RA username directory, which this class maintains
 * locally in settings.
 */
export class FriendsManager implements Manager
{
	private _state: EmuchievementsState;

	private logger: Logger = new Logger("FriendsManager");

	private activity: Record<string, FriendActivity> = {};

	private pollTimer: ReturnType<typeof setInterval> | null = null;

	private polling = false;

	private lastPolledAt = 0;

	constructor(state: EmuchievementsState)
	{
		this._state = state;
	}

	get state(): EmuchievementsState
	{
		return this._state;
	}

	set state(value: EmuchievementsState)
	{
		this._state = value;
	}

	private get settings()
	{
		return this._state.settings;
	}

	private get links(): Record<string, FriendLink>
	{
		return this.settings.friends.links;
	}

	get enabled(): boolean
	{
		return this.settings.friends.enabled;
	}

	/**
	 * Cached activity for every linked friend, most recently active first.
	 */
	getActivity(): FriendActivity[]
	{
		return Object.values(this.activity).sort((a, b) =>
		{
			const aLatest = a.recentAchievements[0]?.unlockedAt ?? 0;
			const bLatest = b.recentAchievements[0]?.unlockedAt ?? 0;
			// Friends currently in a game outrank friends with only historic unlocks.
			const aPlaying = a.richPresenceMsg ? 1 : 0;
			const bPlaying = b.richPresenceMsg ? 1 : 0;
			if (aPlaying !== bPlaying) return bPlaying - aPlaying;
			return bLatest - aLatest;
		});
	}

	/**
	 * Maps a RetroAchievements game id onto a local non-Steam appid, when the user has that
	 * game in their own library. Returns null when they do not - a friend can perfectly well
	 * be playing something the local user does not own.
	 */
	getAppIdForGameId(gameId: number | null): number | null
	{
		if (!gameId) return null;
		return this._state.managers.achievementManager.getAppIdsForRetroGameId(gameId)[0] ?? null;
	}

	getLinks(): FriendLink[]
	{
		return Object.values(this.links);
	}

	getLinkForSteamId(steamId: string): FriendLink | undefined
	{
		return this.links[steamId];
	}

	async setLink(steamId: string, raUsername: string, source: FriendLinkSource, personaName?: string): Promise<void>
	{
		const trimmed = raUsername.trim();
		if (!trimmed)
		{
			await this.removeLink(steamId);
			return;
		}

		this.links[steamId] = {
			steam_id: steamId,
			ra_username: trimmed,
			source,
			verified_at: source === "motto" ? new Date().toISOString() : null,
			persona_name: personaName ?? this.links[steamId]?.persona_name ?? null,
		};

		await this.settings.writeSettings();
		this._state.notifyUpdate();
	}

	async removeLink(steamId: string): Promise<void>
	{
		delete this.links[steamId];
		delete this.activity[steamId];
		await this.settings.writeSettings();
		this._state.notifyUpdate();
	}

	/**
	 * The token a user pastes into their own RetroAchievements motto so friends can verify them.
	 */
	static mottoToken(steamId: string): string
	{
		return `steam:${steamId}`;
	}

	private async fetchRa<T>(endpoint: string, params: Record<string, string>): Promise<T | null>
	{
		const { username, api_key } = this.settings.retroachievements;
		if (!username || !api_key) return null;

		const query = new URLSearchParams({ z: username, y: api_key, ...params });

		return await this._state.managers.achievementManager.enqueue(async () =>
		{
			try
			{
				const response = await fetchNoCors(`${RA_API}/${endpoint}?${query.toString()}`, {
					headers: {
						"User-Agent": `Emuchievements/${process.env.VERSION} (+https://github.com/EmuDeck/Emuchievements)`,
					},
				});

				if (!response.ok)
				{
					this.logger.debug(`${endpoint} responded ${response.status}`);
					return null;
				}

				return JSON.parse(await response.text()) as T;
			} catch (e)
			{
				this.logger.error(e, `Request to ${endpoint} failed`);
				return null;
			}
		});
	}

	/**
	 * Fetches a RetroAchievements profile. This one endpoint carries the motto used for
	 * verification *and* the live presence fields, so linking and activity share a request.
	 */
	private async fetchProfile(raUsername: string): Promise<GetUserProfileResponse | null>
	{
		const profile = await this.fetchRa<GetUserProfileResponse>("API_GetUserProfile.php", { u: raUsername });

		// Unknown users come back as a well-formed object with no identity rather than a 404.
		if (!profile || !profile.User || !profile.ID) return null;

		return profile;
	}

	private async fetchRecentAchievements(raUsername: string, minutes: number): Promise<FriendAchievement[]>
	{
		const raw = await this.fetchRa<GetUserRecentAchievementsResponse>(
			"API_GetUserRecentAchievements.php",
			{ u: raUsername, m: `${Math.max(1, Math.round(minutes))}` }
		);

		if (!Array.isArray(raw)) return [];

		return raw
			.map((entry) => ({
				achievementId: Number(entry.AchievementID),
				title: entry.Title ?? "",
				description: entry.Description ?? "",
				points: Number(entry.Points ?? 0),
				badgeUrl: entry.BadgeURL
					? `https://media.retroachievements.org${entry.BadgeURL}`
					: `https://media.retroachievements.org/Badge/${entry.BadgeName ?? "0"}.png`,
				gameId: Number(entry.GameID),
				gameTitle: entry.GameTitle ?? "",
				hardcore: Number(entry.HardcoreMode) === 1,
				// RA timestamps are UTC but arrive without a zone marker.
				unlockedAt: entry.Date ? new Date(`${entry.Date.replace(" ", "T")}Z`).getTime() : 0,
			}))
			.sort((a, b) => b.unlockedAt - a.unlockedAt);
	}

	/**
	 * Checks whether a RetroAchievements account has published this SteamID64 in its motto.
	 */
	async verifyCandidate(steamId: string, raUsername: string): Promise<LinkCandidateStatus>
	{
		if (!RA_USERNAME_PATTERN.test(raUsername)) return "not_found";

		const profile = await this.fetchProfile(raUsername);
		if (!profile) return "not_found";

		const declared: string[] = (profile.Motto ?? "").match(STEAMID64_PATTERN) ?? [];
		return declared.includes(steamId) ? "verified" : "unverified";
	}

	/**
	 * Derives plausible RetroAchievements usernames from a Steam persona name.
	 *
	 * These are only ever candidates for verification. A name collision is not a link: a matching
	 * name with no motto proof stays "unverified" and needs the user to confirm it by hand.
	 */
	private static candidatesFor(personaName: string): string[]
	{
		const base = personaName.trim();
		const candidates = [
			base,
			base.replace(/\s+/g, ""),
			base.replace(/\s+/g, "_"),
			base.replace(/[^A-Za-z0-9_]/g, ""),
		];

		return Array.from(new Set(candidates)).filter((candidate) => RA_USERNAME_PATTERN.test(candidate));
	}

	/**
	 * Probes every unlinked friend for a matching RetroAchievements account and auto-links the
	 * ones that prove ownership through their motto. Unproven name matches are returned as
	 * suggestions and deliberately left unlinked.
	 */
	async scanFriends(onProgress?: (done: number, total: number) => void): Promise<LinkCandidate[]>
	{
		const friends = getSteamFriends().filter((friend) => !this.links[friend.steamId]);
		const results: LinkCandidate[] = [];

		let done = 0;
		for (const friend of friends)
		{
			for (const candidate of FriendsManager.candidatesFor(friend.personaName))
			{
				const status = await this.verifyCandidate(friend.steamId, candidate);
				if (status === "not_found") continue;

				results.push({
					steamId: friend.steamId,
					personaName: friend.personaName,
					raUsername: candidate,
					status,
				});

				if (status === "verified")
				{
					await this.setLink(friend.steamId, candidate, "motto", friend.personaName);
				}

				// One hit per friend is enough; further candidates are variants of the same name.
				break;
			}

			done++;
			onProgress?.(done, friends.length);
		}

		this.logger.log(`Scanned ${friends.length} unlinked friends, found ${results.length} candidates`);
		return results;
	}

	/**
	 * Steam friends merged with their link state, for the settings list.
	 */
	getFriendsWithLinks(): { friend: SteamFriend, link: FriendLink | undefined; }[]
	{
		const friends = getSteamFriends();
		const seen = new Set(friends.map((friend) => friend.steamId));

		// Links whose friend is not currently enumerable still need to be editable, otherwise a
		// failed friend-store probe would strand them with no way to remove them.
		const orphaned = Object.values(this.links)
			.filter((link) => !seen.has(link.steam_id))
			.map((link) => ({
				friend: {
					steamId: link.steam_id,
					personaName: link.persona_name ?? link.steam_id,
					avatarUrl: null,
					inGameAppId: null,
					isOnline: false,
				} as SteamFriend,
				link,
			}));

		return [
			...friends.map((friend) => ({ friend, link: this.links[friend.steamId] })),
			...orphaned,
		];
	}

	async poll(): Promise<void>
	{
		if (this.polling) return;
		if (!this.enabled) return;
		if (!await this._state.loggedIn) return;

		const links = this.getLinks();
		if (links.length === 0) return;

		this.polling = true;
		try
		{
			// Look back far enough to cover the gap since the last poll, so nothing is missed
			// after the Deck sleeps, but never so far that the response becomes huge.
			const elapsedMinutes = this.lastPolledAt
				? (Date.now() - this.lastPolledAt) / 60000
				: this.settings.friends.poll_interval_minutes * 2;
			const lookback = Math.min(Math.max(elapsedMinutes * 2, 60), 60 * 24);

			for (const link of links)
			{
				const profile = await this.fetchProfile(link.ra_username);

				if (!profile)
				{
					this.activity[link.steam_id] = {
						...(this.activity[link.steam_id] ?? {
							steamId: link.steam_id,
							raUsername: link.ra_username,
							personaName: link.persona_name ?? link.steam_id,
							userPic: null,
							richPresenceMsg: null,
							lastGameId: null,
							recentAchievements: [],
						}),
						updatedAt: Date.now(),
						error: "unreachable",
					};
					continue;
				}

				const recentAchievements = await this.fetchRecentAchievements(link.ra_username, lookback);

				this.activity[link.steam_id] = {
					steamId: link.steam_id,
					raUsername: profile.User,
					personaName: link.persona_name ?? profile.User,
					userPic: profile.UserPic ? `https://media.retroachievements.org${profile.UserPic}` : null,
					// RA reports an empty presence string when the user is not in a game.
					richPresenceMsg: profile.RichPresenceMsg?.trim() ? profile.RichPresenceMsg : null,
					lastGameId: Number(profile.LastGameID) || null,
					recentAchievements,
					updatedAt: Date.now(),
				};
			}

			this.lastPolledAt = Date.now();
			this._state.notifyUpdate();
		} catch (e)
		{
			this.logger.error(e, "Friend activity poll failed");
		} finally
		{
			this.polling = false;
		}
	}

	private startPolling(): void
	{
		this.stopPolling();
		const intervalMs = Math.max(5, this.settings.friends.poll_interval_minutes) * 60 * 1000;
		this.pollTimer = setInterval(() => void this.poll(), intervalMs);
	}

	private stopPolling(): void
	{
		if (this.pollTimer !== null)
		{
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	/**
	 * Called when the feature is toggled, so polling starts and stops without a plugin reload.
	 */
	async setEnabled(enabled: boolean): Promise<void>
	{
		this.settings.friends.enabled = enabled;
		await this.settings.writeSettings();

		if (enabled)
		{
			this.startPolling();
			void this.poll();
		} else
		{
			this.stopPolling();
			this.activity = {};
		}

		this._state.notifyUpdate();
	}

	async init(): Promise<void>
	{
		// Settings still hold their defaults at this point: EmuchievementsState.init() starts every
		// manager in the same tick, and AchievementManager's readSettings() has not completed yet.
		// Without this read `enabled` is always false on a cold load and polling never starts.
		// readSettings() is mutex-guarded, so reading it from here as well is safe.
		await this.settings.readSettings();

		if (!this.enabled) return;
		this.startPolling();
		await this.poll();
	}

	async refresh(): Promise<void>
	{
		await this.poll();
	}

	async deinit(): Promise<void>
	{
		this.stopPolling();
		this.activity = {};
	}
}
