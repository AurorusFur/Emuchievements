import Logger from "./logger";

const logger: Logger = new Logger("FriendUtils");

/**
 * A Steam friend, normalised out of whatever shape the running Steam client happens to use.
 */
export interface SteamFriend
{
	/**
	 * SteamID64 as a string. Always a string: SteamID64s are larger than
	 * Number.MAX_SAFE_INTEGER and silently lose precision when parsed as numbers.
	 */
	steamId: string;
	personaName: string;
	avatarUrl: string | null;
	/**
	 * App the friend is currently in, if any. Non-Steam shortcuts report their own local
	 * appid, which is meaningless to us - it is only ever a hint that they are in *something*.
	 */
	inGameAppId: number | null;
	isOnline: boolean;
}

const STEAMID64_PATTERN = /\b(7656\d{13})\b/;

/**
 * Steam accounts start at this offset; a 32-bit account id plus this base is the SteamID64.
 * Needs BigInt - the base alone exceeds Number.MAX_SAFE_INTEGER.
 */
const STEAMID64_BASE = BigInt("76561197960265728");

/**
 * SteamID64s reach the frontend as strings, plain numbers, bigints, or CSteamID-like objects
 * depending on which store produced them. Normalise all of those to a string, or give up.
 */
export function extractSteamId(candidate: any): string | null
{
	if (candidate === null || candidate === undefined) return null;

	if (typeof candidate === "string")
	{
		return STEAMID64_PATTERN.exec(candidate)?.[1] ?? null;
	}

	if (typeof candidate === "bigint")
	{
		const asString = candidate.toString();
		return STEAMID64_PATTERN.test(asString) ? asString : null;
	}

	if (typeof candidate === "number")
	{
		// A bare 32-bit account id: convert it up. Anything larger has already lost precision
		// as a JS number, so it cannot be trusted.
		if (Number.isSafeInteger(candidate) && candidate > 0 && candidate < 0xFFFFFFFF)
		{
			return (BigInt(candidate) + STEAMID64_BASE).toString();
		}
		return null;
	}

	if (typeof candidate === "object")
	{
		for (const method of ["ConvertTo64BitString", "GetSteamID64", "ToString"])
		{
			if (typeof candidate[method] === "function")
			{
				try
				{
					const result = extractSteamId(candidate[method]());
					if (result) return result;
				} catch (_) { /* try the next shape */ }
			}
		}

		if (typeof candidate.GetAccountID === "function")
		{
			try
			{
				const accountId = candidate.GetAccountID();
				if (typeof accountId === "number" && accountId > 0)
				{
					return (BigInt(accountId) + STEAMID64_BASE).toString();
				}
			} catch (_) { /* fall through */ }
		}

		for (const field of ["m_ulSteamID", "m_steamid64", "steamid64", "m_steamid", "steamid", "m_SteamID"])
		{
			if (field in candidate)
			{
				const result = extractSteamId(candidate[field]);
				if (result) return result;
			}
		}
	}

	return null;
}

function firstString(...candidates: any[]): string | null
{
	for (const candidate of candidates)
	{
		if (typeof candidate === "string" && candidate.length > 0) return candidate;
	}
	return null;
}

function firstNumber(...candidates: any[]): number | null
{
	for (const candidate of candidates)
	{
		if (typeof candidate === "number" && candidate > 0) return candidate;
	}
	return null;
}

function normalizeFriend(entry: any): SteamFriend | null
{
	if (!entry || typeof entry !== "object") return null;

	// Friend entries either carry their data directly or wrap it in a persona object.
	const persona = entry.m_persona ?? entry.persona ?? entry;

	const steamId =
		extractSteamId(persona?.m_steamid) ??
		extractSteamId(entry?.m_steamid) ??
		extractSteamId(persona) ??
		extractSteamId(entry);

	if (!steamId) return null;

	const personaName = firstString(
		persona?.m_strPlayerName,
		persona?.persona_name,
		entry?.m_strPlayerName,
		entry?.persona_name,
		entry?.display_name
	) ?? steamId;

	const avatarHash = firstString(persona?.m_strAvatarHash, entry?.m_strAvatarHash);
	const avatarUrl =
		firstString(persona?.m_strAvatarURL, entry?.m_strAvatarURL) ??
		(avatarHash ? `https://avatars.akamai.steamstatic.com/${avatarHash}_full.jpg` : null);

	const personaState = firstNumber(persona?.m_ePersonaState, entry?.m_ePersonaState);

	return {
		steamId,
		personaName,
		avatarUrl,
		// m_unGamePlayedAppID is the field the Steam client actually populates (verified against a
		// live friends list); the others are kept as fallbacks for other client builds.
		inGameAppId: firstNumber(
			persona?.m_unGamePlayedAppID,
			persona?.m_nInGameAppID,
			persona?.m_unAppID,
			entry?.m_nAppIDLastSeenPlaying
		),
		// Absent state is treated as offline rather than guessing online.
		isOnline: personaState !== null && personaState > 0,
	};
}

function collectEntries(source: any): any[]
{
	if (!source) return [];
	if (Array.isArray(source)) return source;
	if (source instanceof Map) return Array.from(source.values());
	if (typeof source.values === "function")
	{
		try { return Array.from(source.values()); } catch (_) { /* not iterable */ }
	}
	if (typeof source === "object") return Object.values(source);
	return [];
}

/**
 * Enumerates the current user's Steam friends.
 *
 * The Steam client exposes no stable, documented friend API to plugins, and neither @decky/ui
 * nor @decky/api ships typings for one - so every access here is a probe with a fallback, and
 * an empty list is a normal outcome rather than an error. Callers must degrade gracefully.
 */
export function getSteamFriends(): SteamFriend[]
{
	const globalWindow = window as any;
	const sources: any[] = [
		globalWindow.friendStore?.allFriends,
		globalWindow.friendStore?.m_mapFriends,
		globalWindow.friendStore?.m_rgFriends,
		globalWindow.FriendStore?.allFriends,
	];

	for (const source of sources)
	{
		const entries = collectEntries(source);
		if (entries.length === 0) continue;

		const friends = entries
			.map(normalizeFriend)
			.filter((friend): friend is SteamFriend => friend !== null);

		if (friends.length > 0)
		{
			return friends.sort((a, b) => a.personaName.localeCompare(b.personaName));
		}
	}

	logger.log(
		"Could not enumerate Steam friends - no known friend store shape matched. " +
		"Friend activity will stay empty; links can still be added by hand."
	);
	return [];
}

/**
 * SteamID64 of the logged-in user, needed so they can publish it in their RetroAchievements
 * motto for friends to verify against. Returns null when it cannot be determined.
 */
export function getCurrentUserSteamId(): string | null
{
	const globalWindow = window as any;
	const candidates = [
		globalWindow.App?.m_CurrentUser?.strSteamID,
		globalWindow.App?.m_CurrentUser?.steamid,
		globalWindow.loginStore?.m_strSteamID,
		globalWindow.g_steamID,
		globalWindow.User?.strSteamID,
	];

	for (const candidate of candidates)
	{
		const steamId = extractSteamId(candidate);
		if (steamId) return steamId;
	}

	logger.log("Could not determine the current user's SteamID64.");
	return null;
}
