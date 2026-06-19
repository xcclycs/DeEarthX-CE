import esbuild from 'rollup-plugin-esbuild'
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json';

export default {
	input: 'src/main.ts',
	output: {
		file: 'dist/bundle.js',
		format: 'cjs',
		inlineDynamicImports: true,
		sourcemap: false
	},
	plugins: [
		esbuild({
			target: 'node16',
			platform: 'node',
			sourceMap: false,
			minify: true,
			minifyWhitespace: true,
			minifyIdentifiers: true,
			minifySyntax: true,
			tsconfig: './tsconfig.json',
		}),
		resolve({
			preferBuiltins: true,
			browser: false,
			extensions: ['.ts', '.js', '.json'],
			dedupe: ['tslib']
		}),
		commonjs({
			transformMixedEsModules: true,
			ignoreDynamicRequires: true
		}),
		json(),
	],
	onwarn: (warning, warn) => {
		if (warning.code === 'CIRCULAR_DEPENDENCY') return;
		if (warning.code === 'THIS_IS_UNDEFINED') return;
		if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
		if (warning.code === 'UNRESOLVED_IMPORT') return;
		warn(warning);
	}
};
