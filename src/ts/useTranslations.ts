import { useState } from "react";
import languages from "./translations";

export type TranslationKey = keyof (typeof languages)['en'];

/**
 * `en` is the source of truth; the other locales are translated externally and lag behind
 * whenever strings are added, so each one is treated as partial and falls back per key.
 */
const dictionaries = languages as Record<keyof typeof languages, Partial<Record<TranslationKey, string>>>;

function translate(lang: keyof typeof languages, key: TranslationKey): string
{
	const translated = dictionaries[lang]?.[key];
	if (translated?.length) return translated;

	const fallback = dictionaries.en?.[key];
	if (fallback?.length) return fallback;

	return key;
}

function getCurrentLanguage(): keyof typeof languages
{
	const steamLang = window.LocalizationManager.m_rgLocalesToUse[0];
	const lang = steamLang.replace(/-([a-z])/g, (_, letter: string) =>
		letter.toUpperCase()
	) as keyof typeof languages;
	return languages[lang] ? lang : 'en';
}

export function useTranslations()
{
	const [lang] = useState(getCurrentLanguage());
	return function (key: TranslationKey): string
	{
		return translate(lang, key);
	};
}

export function getTranslateFunc()
{
	return function (key: TranslationKey): string
	{
		return translate(getCurrentLanguage(), key);
	};
}

export function format(fmt: string, ...args: any[])
{
	return fmt
		.split("%%")
		.reduce((aggregate, chunk, i) =>
			aggregate + chunk + (args[i] || ""), "");
}
