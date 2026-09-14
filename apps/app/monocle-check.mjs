import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const json = (path) => JSON.parse(read(path))
const base = json('./tauri.conf.json')
const release = json('./tauri-release.conf.json')

assert.equal(base.productName, 'Monocle Launcher')
assert.equal(base.identifier, 'dev.monocle.launcher')
assert.notEqual(base.identifier, 'ModrinthApp')
assert.deepEqual(base.plugins['deep-link'].desktop.schemes, ['monocle'])
assert(base.app.windows.every((window) => window.title === 'Monocle Launcher'))
assert(
	json('./tauri.macos.conf.json').app.windows.every(
		(window) => window.title === 'Monocle Launcher',
	),
)
assert.equal(json('./tauri.linux.conf.json').mainBinaryName, 'MonocleLauncher')
assert.equal(release.bundle.createUpdaterArtifacts, false)
assert(!release.build.features.includes('updater'))
assert(!release.app.security.capabilities.includes('updater'))
assert(!JSON.stringify(release).includes('launcher-files.modrinth.com'))
assert(!base.bundle.macOS.dmg.background)
assert(!read('./Info.plist').includes('<string>modrinth</string>'))

const dirs = read('../../packages/app-lib/src/state/dirs.rs')
assert(dirs.includes('Self::env_path("MONOCLE_CONFIG_DIR")'))
assert(!dirs.includes('Self::env_path("THESEUS_CONFIG_DIR")'))
assert(dirs.includes('dirs::data_dir()?.join(app_identifier)'))
const backups = read('../../packages/app-lib/src/state/db_backup.rs')
assert(backups.includes('settings_dir.join("Backups").join("app-db")'))
assert(backups.includes('backup_dir_for_settings(db_path.parent()'))
assert(!backups.includes('join("Modrinth")'))
assert(!backups.includes('THESEUS_DB_BACKUP_DIR'))
assert(read('./src/api/shortcuts/mod.rs').includes('monocle://launch/instance'))
assert(read('../../packages/app-lib/src/api/handler.rs').includes('strip_prefix("monocle://")'))
assert(!read('../../packages/app-lib/src/state/discord.rs').includes('1123683254248148992'))
assert(read('../../packages/app-lib/src/state/settings.rs').includes('telemetry: false'))
assert(read('../../packages/app-lib/src/state/settings.rs').includes('discord_rpc: false'))


const restrictedArtwork = new Set([
	"0993de6a1eb9874f07799c6661bf718d34a50b4b7fc0c2fbac58c24b19e10600",
	"09d637379978b4d362e336a5bbef4dabf2ee764f5f0f11b8f0d28b15846d1e11",
	"1727e769c8748b0628da8535b8313560b776c6a00f6f85d112252ce52ecd34cf",
	"18305f330efb3317fc3f82a5e669b20f102f38e95a3c435d46d5a5d600d71b89",
	"23c54236ce18732215e57fb6f536c5e9b8ceca9dcc23db11e4dcf14bef2c218d",
	"23ce2dc9e0cb8624502acb6697ca4a86150be0a08dd96ade1947c5d0a028477b",
	"2e334b4c5ea68bdd57bf12358ee5a4aa732971e5cc79be5d470053c9b227cae9",
	"3903bab18a3a63f69fcef6cdee39d62c3bf3cce15f86cf2b5cbdf78f40526163",
	"3b95172b26e35483a2deb4537c2405714ca84df943b05043175e579ba3922a56",
	"4eeeaa9826de479041684b43cfc44bfeb3bfc11844ec201be9ab758753090b8f",
	"577a6704e865c6de1f29ee3a84a1370bd0e9615ef16f46e5eaa9a246a4c977c9",
	"5ca63f23b6bbdc5e3965358d62a4755b7fa94153bfc86ffeda7a1b2a1e2ef218",
	"6e2704445c7d7fe1149862a5b776f883ac56b95f43d01c36b988a4123574a35b",
	"6fc0fceb220c6e64aa57b9af213ae4af932bce65024997cf34e0316f52cd609e",
	"754d1bf51ccf5ead929a96ca33bd70cd86683aba77753f6b744d4bc4dd4f8bf4",
	"87cfdcc5fc00fd8e990b20bee054f16d75c07f1a580d39f5686a75f10aec9b1b",
	"907399eba14f5057283e5a00bba70586071afeefee3e509bd13b281b55e5c2fa",
	"939f441aebd518d77c7752354dac56def424599ba15e324c8e479a5e952af921",
	"998a5bf49fdd35388d862b5c26e94b7d055d3a29de122394844c79ab83f8abcc",
	"9b8c9f039edc24d4816158086e8c5e75130a7a0318dfb2e53740e6fdd830e4c7",
	"a3549be01cbe142558c519913351ea00bf54358aec73b76d69bab539e40221f6",
	"a69e979564bfd6f02d8862a2da77a4780328c244fbdc0e786cfdf87a586576f3",
	"c7b048d53cb66daf1231d5d2086395af284c46184e58d0a1f51ad91e36344723",
	"d409d0d80f40891ff41f34be3b4c30d08ef83f916de21c3020a99a285e4bde48",
	"def22c53965b32bf9824b76dfc6df975550c4106aebe1e31c9d1f5effe00f950",
])
function checkArtwork(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (['node_modules', 'build', 'dist', '.turbo'].includes(entry.name)) continue
		const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
		if (entry.isDirectory()) checkArtwork(file)
		else if (/\.(svg|png|webp|ico|icns|jpe?g)$/i.test(entry.name)) {
			const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
			assert(!restrictedArtwork.has(hash), 'Restricted upstream artwork returned: ' + file.pathname)
		}
	}
}
for (const directory of ['../../apps/', '../../packages/', '../../.github/'])
	checkArtwork(new URL(directory, import.meta.url))

const frontend = '../app-frontend/'
assert(base.bundle.resources.includes('resources/monocle-host/'))
assert(read(frontend + 'src/routes.js').includes("path: '/bots'"))
assert(read(frontend + 'src/pages/Bots.vue').includes("invoke('bot_host_control'"))
assert(read('./src/bots.rs').includes('bearer_auth(config.api_token)'))
assert(!read(frontend + 'src/pages/Bots.vue').includes('apiToken'))
assert(read('./src/bots.rs').includes('if !can_stop(&host)'))
assert(read('./src/bots.rs').includes('Policy::none()'))
assert(
	readFileSync(new URL('./resources/monocle-host/lib/monocle-host-0.7.30.jar', import.meta.url))
		.length > 0,
)
assert(!read(frontend + 'src/main.js').includes('setupErrorReporting'))
assert(readFileSync(new URL('./resources/monocle-host/source.tar.gz', import.meta.url)).length > 0)
assert(read(frontend + 'src/helpers/analytics.ts').includes('const allowed = false'))
assert(!read(frontend + 'src/App.vue').includes('<SurveyPopup'))
assert(!read(frontend + 'src/App.vue').includes('<TextLogo'))
assert(read(frontend + 'src/App.vue').includes('alt="Monocle Launcher"'))
assert(read(frontend + 'src/App.vue').includes('const showAd = computed(() => false)'))
assert(!read(frontend + 'src/components/ui/SplashScreen.vue').includes('<svg'))
assert(read(frontend + 'src/components/ui/SplashScreen.vue').includes('monocle-logo.png'))
assert(read(frontend + 'src/components/ui/WelcomeScreen.vue').includes('monocle-logo.png'))
assert(
	read(frontend + 'src/components/ui/modal/AppSettingsModal.vue').includes(
		'Forked from Modrinth App',
	),
)
assert(read(frontend + 'index.html').includes('monocle-icon.png'))
assert.equal(json(frontend + 'package.json').version, '0.1.0-alpha.4')
assert(read('./Cargo.toml').includes('version = "0.1.0-alpha.4"'))
assert(read(frontend + 'src/pages/Bots.vue').includes('<BotWorkerSessions'))
assert(read('./src/bots.rs').includes('bot_worker_sessions_save'))
assert(read('../../packages/app-lib/src/api/instance/run.rs').includes('Credentials::get_for_launch'))
assert(!read(frontend + 'src/components/bot-worker-sessions/index.vue').includes('set_default_user'))

for (const path of [
	'../../apps/frontend', '../../apps/labrinth', '../../apps/docs',
	'../../apps/app-playground', '../../apps/daedalus_client',
	'../../packages/blog', '../../packages/moderation',
	'../../packages/assets/branding', '../../.github/assets',
	'../../.idea/icon.svg', './icons/apple.icon',
	frontend + 'src/assets/modrinth_app.svg',
	frontend + 'src/assets/sad-modrinth-bot.webp',
	frontend + 'src/assets/welcome/modrinth-social-icon.png',
	frontend + 'src/assets/instance-icons/wrench-rinth.png',
]) assert(!existsSync(new URL(path, import.meta.url)), `Removed project/branding returned: ${path}`)
assert(!read('../../packages/assets/index.ts').includes("from './branding/"))
assert(read('../../NOTICE.md').includes('2026-09-13'))
assert.equal(read('../../LICENSE'), read('./LICENSE'))
assert(read('../../COPYING.md').includes('remove all Modrinth branding assets'))
assert.deepEqual(readdirSync(new URL('../../apps', import.meta.url)).sort(), ['app', 'app-frontend'])
assert.deepEqual(readdirSync(new URL('../../.github/workflows', import.meta.url)).filter((file) => /\.ya?ml$/.test(file)), ['launcher-build.yml'])
assert(read(frontend + 'src/components/ui/modal/AppSettingsModal.vue').includes('gplLicense'))

for (const [asset, expected] of [
	['monocle-icon.png', '52f219eec225bfd082fda3d0bf77b264b48496a3adc835e6020b7c8beebe64f9'],
	['monocle-logo.png', '4130049558a3724daf7563aa883e58f4469f861cc6d5244244b5540bc7132045'],
]) {
	const bytes = readFileSync(new URL(frontend + 'src/assets/' + asset, import.meta.url))
	assert.equal(createHash('sha256').update(bytes).digest('hex'), expected)
}
for (const icon of base.bundle.icon) {
	assert(readFileSync(new URL(icon, import.meta.url)).length > 0)
}
for (const license of ['./LICENSE', '../app-frontend/LICENSE', '../../packages/app-lib/LICENSE']) {
	assert(read(license).includes('GNU GENERAL PUBLIC LICENSE'))
}
console.log('Monocle branding, isolation, assets, and update checks passed.')
