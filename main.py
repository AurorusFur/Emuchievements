import json
import logging
import math
import os
import subprocess
import decky_plugin

logging.basicConfig(
	filename="/tmp/emuchievements.log",
	format='[Emuchievements] %(asctime)s %(levelname)s %(message)s',
	filemode='w+',
	force=True
)
logger = logging.getLogger()
logger.setLevel(logging.DEBUG)  # can be changed to logging.DEBUG for debugging issues


class Plugin:
	packet_size: int = 1000
	length: int = 0
	buffer: str = ""
	async def start_write_config(self, length, packet_size = 1000) -> None:
		Plugin.buffer = ""
		Plugin.length = length
		Plugin.packet_size = packet_size

	async def write_config(self, index, data) -> None:
		Plugin.buffer += data
		if index >= Plugin.length - 1:
			Plugin.length = 0
			config = json.loads(Plugin.buffer)
			Plugin.buffer = ""
			with open(os.path.join(decky_plugin.DECKY_PLUGIN_SETTINGS_DIR, "settings.json"), "w") as f:
				json.dump(config, f, indent="\t")

	async def start_read_config(self, packet_size = 1000) -> int:
		Plugin.buffer = ""
		Plugin.length = 0
		Plugin.packet_size = packet_size
		with open(os.path.join(decky_plugin.DECKY_PLUGIN_SETTINGS_DIR, "settings.json"), "r") as f:
			config = json.load(f)
			Plugin.buffer = json.dumps(config, indent="\t")
			Plugin.length = math.ceil(len(Plugin.buffer) / float(Plugin.packet_size))
			return Plugin.length

	async def read_config(self, index) -> str:
		if index < Plugin.length - 1:
			return Plugin.buffer[index * Plugin.packet_size : (index + 1) * Plugin.packet_size]
		else:
			Plugin.length = 0
			config =  Plugin.buffer[index * Plugin.packet_size :]
			Plugin.buffer = ""
			return config

	async def hash(self, path: str) -> str:
		# lib = ctypes.CDLL(f"{helpers.get_homebrew_path(helpers.get_home_path(helpers.get_user()))}/plugins/{plugin}/bin/Emuchievements.so")
		# hash = lib.hash
		# hash.argtypes = [ctypes.c_char_p]
		# hash.restype = ctypes.c_char_p
		# return hash(path.encode('utf-8'))

		# return os.popen(
		# 	f"'{os.path.join(decky_plugin.DECKY_PLUGIN_DIR, 'bin', 'hash')}' \"{path}\"").read().strip()

		logger.debug(f"Hashing ROM: {path}")
		try:
			# Fix PyInstaller Library Issue as Per: https://github.com/xXJSONDeruloXx/Decky-Framegen/
			clean_env = os.environ.copy()
			clean_env["LD_LIBRARY_PATH"] = ""

			hash_bin = os.path.join(decky_plugin.DECKY_PLUGIN_DIR, "backend", "hash")

			cmd = [hash_bin, path]

			# Run the command and capture its output
			result = subprocess.run(
				cmd,
				env=clean_env,
				capture_output=True,
				text=True,  # This decodes stdout and stderr as strings
				check=True  # This raises an exception if the command fails
			)

			# Return the stripped output
			hash_result = result.stdout.strip()
			logger.debug(f"Hash result for {path}: {hash_result}")
			return hash_result
		except subprocess.CalledProcessError as e:
			logger.error(f"Error hashing ROM {path}: exit {e.returncode}, stderr: {e.stderr.strip()}")
		except Exception as e:
			logger.error(f"Error hashing ROM {path}: {e}")
			raise

	
	async def reset(self) -> None:
		Plugin.length = 0
		Plugin.buffer = ""
		Plugin.packet_size = 1000

	def _find_flatpak(self) -> str:
		for candidate in ["/usr/bin/flatpak", "/usr/local/bin/flatpak", "/run/host/usr/bin/flatpak"]:
			if os.path.isfile(candidate):
				return candidate
		try:
			result = subprocess.run(["which", "flatpak"], capture_output=True, text=True)
			if result.returncode == 0:
				return result.stdout.strip()
		except Exception:
			pass
		return ""

	async def _log_tool_versions(self):
		hash_bin = os.path.join(decky_plugin.DECKY_PLUGIN_DIR, "backend", "hash")
		logger.info(f"Hash binary: {hash_bin} (exists: {os.path.exists(hash_bin)})")

		flatpak = Plugin._find_flatpak(self)
		if not flatpak:
			logger.info("flatpak: not found")
			return

		logger.info(f"flatpak binary: {flatpak}")
		deck_user = os.environ.get("SUDO_USER") or os.environ.get("USER") or "deck"

		try:
			installed = subprocess.run(
				["sudo", "-u", deck_user, flatpak, "list", "--app", "--columns=application"],
				capture_output=True, text=True
			).stdout.splitlines()
		except Exception as e:
			logger.debug(f"Could not list flatpaks: {e}")
			installed = []

		for flatpak_id in ["org.DolphinEmu.dolphin-emu", "io.github.shiiion.primehack"]:
			if flatpak_id not in installed:
				logger.info(f"Flatpak {flatpak_id}: not installed")
				continue
			try:
				result = subprocess.run(
					["sudo", "-u", deck_user, flatpak, "info", flatpak_id],
					capture_output=True, text=True
				)
				version_line = next((l for l in result.stdout.splitlines() if "Version:" in l), None)
				logger.info(f"Flatpak {flatpak_id}: {version_line.strip() if version_line else 'installed (version unknown)'}")
			except Exception as e:
				logger.debug(f"Could not get info for {flatpak_id}: {e}")

	# Asyncio-compatible long-running code, executed in a task when the plugin is loaded
	async def _main(self):
		await Plugin._log_tool_versions(self)
		if not os.path.exists(os.path.join(decky_plugin.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")):
			with open(os.path.join(decky_plugin.DECKY_PLUGIN_SETTINGS_DIR, "settings.json"), "w") as f:
				json.dump({
					"username": "",
					"api_key": "",
					"cache": {
						"ids": {}
					},
					"hidden": False
				}, f, indent="\t")


	async def _unload(self):
		pass

	async def _migration(self):
		decky_plugin.migrate_settings(
			os.path.join(decky_plugin.DECKY_HOME, "settings", "emuchievements.json"))
		if os.path.exists(os.path.join(decky_plugin.DECKY_PLUGIN_SETTINGS_DIR, "emuchievements.json")):
			os.rename(os.path.join(decky_plugin.DECKY_PLUGIN_SETTINGS_DIR, "emuchievements.json"),
					os.path.join(decky_plugin.DECKY_PLUGIN_SETTINGS_DIR, "settings.json"))
