use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fs::{self, OpenOptions};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_http::reqwest;
use tokio::sync::Mutex;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
	pub data_dir: PathBuf,
	pub java_path: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostConfig {
	api_port: u16,
	api_token: String,
	bind: String,
	worker_port: u16,
	crews: std::collections::BTreeMap<String, String>,
}

#[derive(Default)]
pub struct HostProcess(pub Mutex<Option<(Child, PathBuf)>>);

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkerSession {
	pub worker: uuid::Uuid,
	pub account: uuid::Uuid,
	pub instance: String,
	#[serde(default)]
	pub server: String,
}

fn validate_sessions(sessions: &[WorkerSession]) -> Result<(), String> {
	if sessions.len() > 256 {
		return Err("Too many local worker sessions".into());
	}
	let mut workers = std::collections::HashSet::new();
	let mut accounts = std::collections::HashSet::new();
	let mut instances = std::collections::HashSet::new();
	for session in sessions {
		if session.worker.is_nil() || session.account.is_nil()
			|| session.instance.is_empty() || session.instance.len() > 512
			|| session.instance.chars().any(char::is_control)
			|| session.server.len() > 253 || session.server.chars().any(char::is_control)
			|| !workers.insert(session.worker)
			|| !accounts.insert(session.account)
			|| !instances.insert(&session.instance)
		{
			return Err("Each worker needs its own account and instance".into());
		}
	}
	Ok(())
}

async fn sessions_file() -> Result<PathBuf, String> {
	Ok(settings_file().await?.with_file_name("bot-worker-sessions.json"))
}

#[tauri::command]
pub async fn bot_worker_sessions() -> Result<Vec<WorkerSession>, String> {
	let file = sessions_file().await?;
	if !file.exists() { return Ok(Vec::new()); }
	if fs::metadata(&file).map_err(|e| e.to_string())?.len() > 262_144 {
		return Err("Worker session settings exceed limit".into());
	}
	let sessions: Vec<WorkerSession> = serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
		.map_err(|e| e.to_string())?;
	validate_sessions(&sessions)?;
	Ok(sessions)
}

#[tauri::command]
pub async fn bot_worker_sessions_save(sessions: Vec<WorkerSession>) -> Result<(), String> {
	static SAVE: Mutex<()> = Mutex::const_new(());
	let _save = SAVE.lock().await;
	validate_sessions(&sessions)?;
	let processes = theseus::process::get_all().await.map_err(|e| e.to_string())?;
	let previous_sessions = bot_worker_sessions().await?;
	for next in &sessions {
		if !previous_sessions.contains(next) && processes.iter().any(|p| p.instance_id == next.instance) {
			return Err("Stop this game before binding its account and instance".into());
		}
	}
	for previous in previous_sessions {
		if !sessions.contains(&previous) && processes.iter().any(|p| p.instance_id == previous.instance) {
			return Err("Stop this game session before changing its binding".into());
		}
	}
	let file = sessions_file().await?;
	let temporary = file.with_extension("json.tmp");
	fs::write(&temporary, serde_json::to_vec(&sessions).map_err(|e| e.to_string())?)
		.map_err(|e| e.to_string())?;
	fs::rename(temporary, file).map_err(|e| e.to_string())
}

async fn settings_file() -> Result<PathBuf, String> {
	let state = theseus::State::get().await.map_err(|e| e.to_string())?;
	Ok(state
		.directories
		.settings_dir
		.join("bot-host-settings.json"))
}

#[tauri::command]
pub async fn bot_host_settings() -> Result<Settings, String> {
	let file = settings_file().await?;
	if file.exists() {
		return serde_json::from_slice(
			&fs::read(file).map_err(|e| e.to_string())?,
		)
		.map_err(|e| e.to_string());
	}
	Ok(Settings {
		data_dir: file.parent().unwrap().join("bot-host"),
		java_path: PathBuf::new(),
	})
}

fn config(settings: &Settings) -> Result<HostConfig, String> {
	let path = settings.data_dir.join("host-config.json");
	if fs::metadata(&path)
		.map_err(|_| "Initialize this host directory first")?
		.len() > 16_384
	{
		return Err("Host configuration is too large".into());
	}
	let config: HostConfig =
		serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
			.map_err(|_| "Invalid host configuration")?;
	if config.api_port == 0
		|| config.api_token.len() < 32
		|| config.api_token.len() > 128
	{
		return Err("Invalid host API port or token".into());
	}
	Ok(config)
}

async fn request(
	settings: &Settings,
	body: Option<Value>,
) -> Result<Value, String> {
	let config = config(settings)?;
	let client = reqwest::Client::builder()
		.no_proxy()
		.redirect(reqwest::redirect::Policy::none())
		.timeout(Duration::from_secs(if body.is_some() { 8 } else { 3 }))
		.build()
		.map_err(|e| e.to_string())?;
	let url = format!(
		"http://127.0.0.1:{}{}",
		config.api_port,
		if body.is_some() {
			"/control"
		} else {
			"/v1/status"
		}
	);
	let mut request = if let Some(body) = body {
		let bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
		if bytes.len() > 4 * 1024 * 1024 + 65_536 {
			return Err("Workflow request is too large".into());
		}
		client
			.post(url)
			.header("Content-Type", "application/json")
			.body(bytes)
	} else {
		client.get(url)
	};
	request = request.bearer_auth(config.api_token);
	let mut response = request.send().await.map_err(|_| {
		"Host unavailable. Check its data directory, ports and log.".to_string()
	})?;
	let status = response.status();
	let mut bytes = Vec::new();
	while let Some(chunk) = response
		.chunk()
		.await
		.map_err(|_| "Host response interrupted")?
	{
		if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
			return Err("Host response exceeds limit".into());
		}
		bytes.extend_from_slice(&chunk);
	}
	let value: Value =
		serde_json::from_slice(&bytes).map_err(|_| "Invalid host response")?;
	if !status.is_success() {
		return Err(format!(
			"Host rejected request: {}",
			value["error"].as_str().unwrap_or("Host rejected request")
		));
	}
	Ok(value)
}

fn active_process(
	process: &mut Option<(Child, PathBuf)>,
) -> Result<Option<u32>, String> {
	if let Some((child, _)) = process {
		if child.try_wait().map_err(|e| e.to_string())?.is_none() {
			return Ok(Some(child.id()));
		}
		*process = None;
	}
	Ok(None)
}

#[tauri::command]
pub async fn bot_host_save(
	settings: Settings,
	process: tauri::State<'_, HostProcess>,
) -> Result<(), String> {
	if !settings.data_dir.is_absolute()
		|| (!settings.java_path.as_os_str().is_empty()
			&& !settings.java_path.is_absolute())
	{
		return Err(
			"Use absolute data-directory and Java executable paths".into()
		);
	}
	let mut process = process.0.lock().await;
	if active_process(&mut process)?.is_some() {
		return Err(
			"Stop the launcher-managed host before changing its connection"
				.into(),
		);
	}
	let file = settings_file().await?;
	let temporary = file.with_extension("json.tmp");
	fs::write(
		&temporary,
		serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
	)
	.map_err(|e| e.to_string())?;
	fs::rename(temporary, file).map_err(|e| e.to_string())?;
	Ok(())
}

fn java_command(
	app: &tauri::AppHandle,
	settings: &Settings,
	operation: &str,
) -> Result<Command, String> {
	let runtime = app
		.path()
		.resource_dir()
		.map_err(|e| e.to_string())?
		.join("resources/monocle-host/lib");
	if !runtime.join("monocle-host-0.7.30.jar").is_file() {
		return Err("Bundled Monocle host runtime is missing".into());
	}
	let mut command = Command::new(&settings.java_path);
	command
		.arg("-Xmx512m")
		.arg("-cp")
		.arg(runtime.join("*"))
		.arg("dev.monocle.host.Main")
		.arg(operation)
		.arg(&settings.data_dir)
		.stdin(Stdio::null());
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		command.creation_flags(0x08000000);
	}
	Ok(command)
}

async fn check_java(settings: &Settings) -> Result<(), String> {
	if settings.java_path.as_os_str().is_empty()
		|| !theseus::jre::test_jre(settings.java_path.clone(), 25)
			.await
			.map_err(|e| e.to_string())?
	{
		return Err(
			"Select a Java 25 executable, or install Java 25 below".into()
		);
	}
	Ok(())
}

#[tauri::command]
pub async fn bot_host_initialize(app: tauri::AppHandle) -> Result<(), String> {
	let settings = bot_host_settings().await?;
	check_java(&settings).await?;
	let output = java_command(&app, &settings, "init")?
		.output()
		.map_err(|e| e.to_string())?;
	if !output.status.success() {
		return Err("Host initialization failed. Existing configurations are never overwritten.".into());
	}
	Ok(())
}

#[tauri::command]
pub async fn bot_host_start(
	app: tauri::AppHandle,
	process: tauri::State<'_, HostProcess>,
) -> Result<Value, String> {
	let settings = bot_host_settings().await?;
	let mut process = process.0.lock().await;
	if active_process(&mut process)?.is_some() {
		return Err("This launcher already manages a running host".into());
	}
	if request(&settings, None).await.is_ok() {
		return Err("Host is already running. Connect instead; the launcher will not take ownership.".into());
	}
	config(&settings)?;
	check_java(&settings).await?;
	let log = OpenOptions::new()
		.create(true)
		.append(true)
		.open(settings.data_dir.join("launcher-host.log"))
		.map_err(|e| e.to_string())?;
	let child = java_command(&app, &settings, "serve")?
		.stdout(log.try_clone().map_err(|e| e.to_string())?)
		.stderr(log)
		.spawn()
		.map_err(|e| e.to_string())?;
	let pid = child.id();
	*process = Some((child, settings.data_dir));
	Ok(json!({ "pid": pid }))
}

#[tauri::command]
pub async fn bot_host_snapshot(
	process: tauri::State<'_, HostProcess>,
) -> Result<Value, String> {
	let settings = bot_host_settings().await?;
	let pid = active_process(&mut *process.0.lock().await)?;
	let connection = request(&settings, None).await;
	let endpoint = config(&settings)
		.ok()
		.map(|c| format!("{}:{}", c.bind, c.worker_port));
	Ok(match connection {
		Ok(host) => {
			json!({ "connected": true, "managed": pid.is_some(), "pid": pid, "endpoint": endpoint, "host": host })
		}
		Err(error) => {
			json!({ "connected": false, "managed": pid.is_some(), "pid": pid, "error": error })
		}
	})
}

#[tauri::command]
pub async fn bot_host_control(body: Value) -> Result<Value, String> {
	if !matches!(
		body["op"].as_str(),
		Some(
			"submit"
				| "pause" | "resume"
				| "cancel" | "priority"
				| "delete" | "end-highway" | "task-get" | "task-release"
				| "workflow-list" | "workflow-get" | "workflow-save"
				| "workflow-duplicate" | "workflow-delete"
				| "draft-save" | "draft-get" | "draft-delete" | "draft-assign"
				| "crew-create" | "crew-rename" | "crew-delete" | "crew-move"
				| "resolve-transfers" | "host-settings"
		)
	) {
		return Err("Unsupported launcher control operation".into());
	}
	request(&bot_host_settings().await?, Some(body)).await
}

fn can_stop(host: &Value) -> bool {
	host["tasks"]
		.as_array()
		.is_some_and(|tasks| tasks.is_empty())
		&& host["highways"].as_object().is_some_and(|crews| {
			crews.values().all(|c| {
				c["pendingEnds"].as_u64() == Some(0)
					&& c["phase"].as_str() == Some("idle")
			})
		}) && host["workers"].as_array().is_some_and(|workers| {
		workers
			.iter()
			.filter(|w| w["connected"] == true)
			.all(|w| w["current"].as_str() == Some(""))
	})
}

#[tauri::command]
pub async fn bot_host_stop(
	process: tauri::State<'_, HostProcess>,
) -> Result<(), String> {
	let mut process = process.0.lock().await;
	active_process(&mut process)?;
	let (child, directory) = process
		.as_mut()
		.ok_or("This launcher does not own the host process")?;
	let settings = bot_host_settings().await?;
	if &settings.data_dir != directory {
		return Err("Host ownership mismatch".into());
	}
	let host = request(&settings, None).await?;
	if !can_stop(&host) {
		return Err(
			"Cancel jobs and wait for worker cleanup before stopping the host"
				.into(),
		);
	}
	child.kill().map_err(|e| e.to_string())?;
	child.wait().map_err(|e| e.to_string())?;
	*process = None;
	Ok(())
}

#[tauri::command]
pub async fn bot_host_crew_keys() -> Result<Value, String> {
	let config = config(&bot_host_settings().await?)?;
	Ok(json!(config.crews))
}

#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn worker_sessions_are_unique_and_bounded() {
		let session = WorkerSession { worker: uuid::Uuid::new_v4(), account: uuid::Uuid::new_v4(), instance: "instance-one".into(), server: String::new() };
		assert!(validate_sessions(&[session.clone()]).is_ok());
		assert!(validate_sessions(&[session.clone(), session.clone()]).is_err());
		let mut other = session.clone();
		other.worker = uuid::Uuid::new_v4();
		other.instance = "instance-two".into();
		assert!(validate_sessions(&[session.clone(), other.clone()]).is_err());
		other.account = uuid::Uuid::new_v4();
		assert!(validate_sessions(&[session.clone(), other.clone()]).is_ok());
		other.instance = session.instance.clone();
		assert!(validate_sessions(&[session, other]).is_err());
	}
	#[test]
	fn stopping_requires_idle_jobs_and_cleanup() {
		let mut host = json!({"tasks":[],"highways":{"Default":{"phase":"idle","pendingEnds":0}},"workers":[{"connected":true,"current":""}]});
		assert!(can_stop(&host));
		host["highways"]["Default"]["pendingEnds"] = json!(1);
		assert!(!can_stop(&host));
		host["highways"]["Default"]["pendingEnds"] = json!(0);
		host["tasks"] = json!([{"status":"Cancelled","cleanupPending":true}]);
		assert!(!can_stop(&host));
		host["tasks"] = json!([]);
		host["workers"][0]["current"] = json!("running-task");
		assert!(!can_stop(&host));
		assert!(!can_stop(&json!({})));
	}
}
