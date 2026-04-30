#include <iostream>
#include <filesystem>
#include <regex>
#include <cstdlib>
#include <cstdio>
#include <unistd.h>
#include <algorithm>
#include <cctype>

#include "HashCHD.h"
#include "rc_hash.h"
#include "rc_consoles.h"
#include "util.h"

// Case-insensitive file open: tries exact path first, then scans the directory.
// Fixes rcheevos failing to open .bin files on Linux when .cue references them
// with different casing than the actual filename on disk.
static void* ci_file_open(const char* path)
{
	FILE* f = fopen(path, "rb");
	if (f) return f;

	std::filesystem::path p(path);
	auto dir = p.parent_path();
	if (!std::filesystem::is_directory(dir)) return nullptr;

	std::string target = p.filename().string();
	std::string lower_target = target;
	std::transform(lower_target.begin(), lower_target.end(), lower_target.begin(), ::tolower);

	for (auto& entry : std::filesystem::directory_iterator(dir))
	{
		std::string name = entry.path().filename().string();
		std::string lower_name = name;
		std::transform(lower_name.begin(), lower_name.end(), lower_name.begin(), ::tolower);
		if (lower_name == lower_target)
			return fopen(entry.path().c_str(), "rb");
	}
	return nullptr;
}

static void ci_file_seek(void* handle, int64_t offset, int origin) { fseeko((FILE*)handle, offset, origin); }
static int64_t ci_file_tell(void* handle) { return ftello((FILE*)handle); }
static size_t ci_file_read(void* handle, void* buf, size_t n) { return fread(buf, 1, n, (FILE*)handle); }
static void ci_file_close(void* handle) { fclose((FILE*)handle); }

static rc_hash_filereader ci_reader = { ci_file_open, ci_file_seek, ci_file_tell, ci_file_read, ci_file_close };

bool has_extension(const std::filesystem::path &path, const std::string &findExt)
{
	std::string ext = path.extension();
	for (auto &c: ext)
	{
		c = tolower(c);
	}

	return ext.find(findExt) != std::string::npos;
}

std::string hash_file(const std::filesystem::path &path)
{
	char *buf = new char[33];

	auto *iterator = new rc_hash_iterator();

	rc_hash_init_custom_filereader(&ci_reader);
	if (has_extension(path, "chd"))
	{
		rc_hash_init_chd_cdreader();
	} else
	{
		rc_hash_init_default_cdreader();
	}

	rc_hash_initialize_iterator(iterator, path.c_str(), nullptr, 0);

	rc_hash_iterate(buf, iterator);

	rc_hash_destroy_iterator(iterator);
	std::string hash(buf);
	delete[] buf;
	delete iterator;
	return hash;
}

// Returns the flatpak app ID of an installed dolphin-tool, or empty string if none found.
std::string find_dolphin_flatpak()
{
	static const char* candidates[] = {
		"org.DolphinEmu.dolphin-emu",
		"io.github.shiiion.primehack",
		nullptr
	};

	for (int i = 0; candidates[i]; ++i)
	{
		std::string check = "/usr/bin/flatpak info ";
		check += candidates[i];
		check += " >/dev/null 2>&1";
		if (std::system(check.c_str()) == 0)
			return candidates[i];
	}

	return "";
}

std::string hash_dolphin_format(const std::filesystem::path &path)
{
	std::string app_id = find_dolphin_flatpak();
	if (app_id.empty())
		return "";

	std::string cmd = "/usr/bin/flatpak run --filesystem=host --command=dolphin-tool "
		+ app_id + " verify -a rchash -i \"" + path.string() + "\" 2>/dev/null";

	FILE *pipe = popen(cmd.c_str(), "r");
	if (!pipe)
		return "";

	char buffer[256];
	std::string output;
	while (fgets(buffer, sizeof(buffer), pipe))
		output += buffer;
	pclose(pipe);

	std::regex hash_regex("[0-9a-fA-F]{32}");
	std::smatch match;
	if (std::regex_search(output, match, hash_regex))
		return match[0];

	return "";
}

std::string hash(const std::filesystem::path &path)
{
	std::string hash;
	// Archive Type - Extract
	if (has_extension(path, "zip") || has_extension(path, "7z"))
	{
		auto extracted = util::extract(path.string());
		if (std::filesystem::is_regular_file(extracted))
		{
			hash = hash_file(extracted);
			std::filesystem::remove_all(extracted.parent_path());
		} else
		{
			hash = hash_file(path);
			std::filesystem::remove_all(extracted);
		}
		return hash;
	}
	// Dolphin compressed formats - use dolphin-tool verify to get RA hash directly
	else if (has_extension(path, "rvz") || has_extension(path, "gcz") ||
	         has_extension(path, "wbfs") || has_extension(path, "wia"))
	{
		hash = hash_dolphin_format(path);
		return hash;
	}
	// Other - Just Hash The File (Includes .iso, etc.)
	else
	{
		hash = hash_file(path);
		return hash;
	}
}

int main(int argc, char **argv)
{
	if (argc != 2)
	{
		return 1;
	}

	std::filesystem::path path(argv[1]);
	std::cout << hash(path) << std::endl;
	return 0;
}
