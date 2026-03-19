import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import typescript from '@rollup/plugin-typescript';
import {defineConfig} from 'rollup';
import importAssets from 'rollup-plugin-import-assets';

import {name} from "./plugin.json";
import {version} from "./package.json";
import {createPathTransform} from "rollup-sourcemap-path-transform";

const production = process.env["RELEASE_TYPE"] !== 'development'

// @decky/api bundles itself but needs @decky/manifest to supply plugin name+version
function deckyManifest() {
	return {
		name: 'decky-manifest',
		resolveId(id) {
			if (id === '@decky/manifest') return '\0@decky/manifest';
		},
		load(id) {
			if (id === '\0@decky/manifest') {
				return `const manifest = { name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)} }; export const name = manifest.name; export const version = manifest.version; export default manifest;`;
			}
		}
	};
}

export default defineConfig({
	input: './src/ts/index.tsx',
	plugins: [
		deckyManifest(),
		commonjs(),
		nodeResolve({browser: true}),
		typescript({ sourceMap: !production, inlineSources: !production }),
		json(),
		replace({
			preventAssignment: false,
			'process.env.NODE_ENV': JSON.stringify(process.env["RELEASE_TYPE"]),
			'process.env.VERSION': JSON.stringify(version),
		}),
		importAssets({
			publicPath: `http://127.0.0.1:1337/plugins/${name}/`
		})

	],
	context: 'window',
	external: ['react', 'react-dom', '@decky/ui'],
	output: {
		file: 'dist/index.js',
		sourcemap: !production ? 'inline' : false,
		sourcemapPathTransform: !production ? createPathTransform({
			prefixes: {
				"../src/src/ts/": `/plugins/${name}/src/`,
				"../node_modules/.pnpm/": `/plugins/${name}/node_modules/`
			},
			requirePrefix: true
		}) : undefined,
		footer: () => !production ? `\n//# sourceURL=http://localhost:1337/plugins/${name}/frontend_bundle` : "",
		globals: {
			react: 'SP_REACT',
			'react-dom': 'SP_REACTDOM',
			'@decky/ui': 'DFL',
		},
		format: 'iife',
		exports: 'default',
	},
});

