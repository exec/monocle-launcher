use quartz_nbt::{NbtCompound, NbtList, NbtTag, io::{Flavor, read_nbt, write_nbt}};
use std::{fs, io::{Cursor, Read, Write}, path::{Path, PathBuf}};

const LIMIT: u64 = 16 * 1024 * 1024;

fn checked_path(directory: &Path, name: &str) -> Result<PathBuf, String> {
	let path = directory.join(name);
	if let Ok(meta) = fs::symlink_metadata(&path) {
		if meta.file_type().is_symlink() { return Err(format!("Refusing to replace linked configuration: {name}")); }
	}
	Ok(path)
}

fn read(path: &Path) -> Result<Option<Vec<u8>>, String> {
	if !path.exists() { return Ok(None); }
	let file = fs::File::open(path).map_err(|e| e.to_string())?;
	let mut bytes = Vec::new();
	file.take(LIMIT + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
	if bytes.len() as u64 > LIMIT { return Err("Monocle configuration exceeds 16 MiB".into()); }
	Ok(Some(bytes))
}

fn decode(bytes: Option<&[u8]>) -> Result<NbtCompound, String> {
	match bytes {
		Some(bytes) => read_nbt(&mut Cursor::new(bytes), Flavor::Uncompressed).map(|(root, _)| root)
			.map_err(|_| "Invalid Monocle NBT settings; original file was left intact".into()),
		None => Ok(NbtCompound::new()),
	}
}

fn encode(root: &NbtCompound) -> Result<Vec<u8>, String> {
	let mut bytes = Vec::new();
	write_nbt(&mut bytes, None, root, Flavor::Uncompressed).map_err(|e| e.to_string())?;
	Ok(bytes)
}

fn compound<'a>(root: &'a mut NbtCompound, key: &str) -> Result<&'a mut NbtCompound, String> {
	if !root.contains_key(key) { root.insert(key, NbtCompound::new()); }
	root.get_mut::<_, &mut NbtCompound>(key).map_err(|_| format!("Invalid {key} settings compound"))
}

fn list<'a>(root: &'a mut NbtCompound, key: &str) -> Result<&'a mut NbtList, String> {
	if !root.contains_key(key) { root.insert(key, NbtList::new()); }
	root.get_mut::<_, &mut NbtList>(key).map_err(|_| format!("Invalid {key} settings list"))
}

fn named<'a>(list: &'a mut NbtList, name: &str) -> Result<&'a mut NbtCompound, String> {
	let mut index = None;
	for (i, entry) in list.iter().enumerate() {
		let NbtTag::Compound(entry) = entry else { return Err("Invalid settings entry".into()); };
		if entry.get::<_, &str>("name").map_err(|_| "Unnamed settings entry")? == name {
			if index.replace(i).is_some() { return Err("Duplicate settings entry".into()); }
		}
	}
	let i = index.unwrap_or_else(|| {
		let mut entry = NbtCompound::new(); entry.insert("name", name);
		list.push(entry); list.len() - 1
	});
	list.get_mut::<&mut NbtCompound>(i).map_err(|e| e.to_string())
}

fn connection(root: &mut NbtCompound, address: &str, port: u16, key: &str) -> Result<(), String> {
	if address.is_empty() || address.len() > 253 || address.chars().any(char::is_control)
		|| port == 0 || !(24..=128).contains(&key.len()) || key.chars().any(char::is_control) {
		return Err("Invalid worker host connection".into());
	}
	let settings = compound(root, "settings")?;
	let group = named(list(settings, "groups")?, "General")?;
	let values = list(group, "settings")?;
	for (name, value) in [
		("mode", NbtTag::String("Worker".into())),
		("ip", NbtTag::String(address.into())),
		("port", NbtTag::Int(i32::from(port))),
		("crew-key", NbtTag::String(key.into())),
		("accept-highway-assignments", NbtTag::Byte(1)),
	] { named(values, name)?.insert("value", value); }
	root.insert("active", 1_i8);
	Ok(())
}

fn copy_module_settings(target: &mut NbtCompound, source: &NbtCompound) -> Result<(), String> {
	let modules = source.get::<_, &NbtList>("modules").map_err(|_| "Source has no module settings")?;
	let target = list(target, "modules")?;
	let mut seen = std::collections::HashSet::new();
	for entry in modules.iter() {
		let NbtTag::Compound(module) = entry else { return Err("Invalid source module".into()); };
		let name = module.get::<_, &str>("name").map_err(|_| "Unnamed source module")?;
		if !seen.insert(name) { return Err("Duplicate source module".into()); }
		let settings = module.get::<_, &NbtCompound>("settings").map_err(|_| "Invalid source module settings")?;
		// Enabled states, keybinds and recovery ownership belong to the target / job, not the source account.
		named(target, name)?.insert("settings", settings.clone());
	}
	Ok(())
}

fn has_recovery(directory: &Path) -> Result<bool, String> {
	for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
		let name = entry.map_err(|e| e.to_string())?.file_name();
		let name = name.to_string_lossy();
		if name == "swarm-crew-recovery.json" || name.starts_with("bot-crew-") && name.ends_with(".json")
			|| name.starts_with("bot-ended-") && name.ends_with("-supplies.json") { return Ok(true); }
	}
	if let Some(bytes) = read(&checked_path(directory, "bot-worker-tasks.json")?)? {
		let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid worker checkpoint; config preparation deferred")?;
		if value.get("original").is_some() { return Ok(true); }
		let runs = value["runs"].as_object().ok_or("Unrecognized worker checkpoint; config preparation deferred")?;
		for run in runs.values() {
			if !matches!(run["status"].as_str(), Some("Complete" | "Cancelled" | "Failed")) { return Ok(true); }
			if run["stack"].as_array().is_some_and(|frames| frames.iter().any(|f| f.get("native").is_some() || f.get("commandSent").is_some())) { return Ok(true); }
		}
	}
	Ok(false)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
	let mut temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing configuration directory")?).map_err(|e| e.to_string())?;
	temporary.write_all(bytes).and_then(|_| temporary.as_file().sync_all()).map_err(|e| e.to_string())?;
	temporary.persist(path).map_err(|e| e.to_string())?;
	Ok(())
}

pub(super) fn prepare(instance: &Path, template: Option<&Path>, host: Option<(&str, u16, &str)>) -> Result<String, String> {
	let directory = checked_path(instance, "monocle-client")?;
	fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
	// Do not mirror the client's recovery state machine. Existing recovery owns its configuration until it finishes.
	match has_recovery(&directory) {
		Ok(false) => {},
		Ok(true) => return Ok("existing recovery retained; startup configuration unchanged".into()),
		Err(_) => return Ok("checkpoint needs client reconciliation; startup configuration unchanged".into()),
	}
	let mut changes = Vec::new();
	if let Some((address, port, key)) = host {
		let path = checked_path(&directory, "bots.nbt")?;
		let old = read(&path)?;
		let mut root = decode(old.as_deref())?;
		let before = root.clone();
		connection(&mut root, address, port, key)?;
		if root != before { changes.push((path, old, encode(&root)?)); }
	}
	if let Some(template) = template {
		let source = checked_path(&checked_path(template, "monocle-client")?, "modules.nbt")?;
		let source = read(&source)?.ok_or("Settings source has no modules.nbt. Start Monocle in that instance and save its settings first.")?;
		let source = decode(Some(&source))?;
		let path = checked_path(&directory, "modules.nbt")?;
		let old = read(&path)?;
		let mut root = decode(old.as_deref())?;
		let before = root.clone();
		copy_module_settings(&mut root, &source)?;
		if root != before { changes.push((path, old, encode(&root)?)); }
	}
	if changes.is_empty() { return Ok("saved configuration already current".into()); }
	let backups = checked_path(&directory, "launcher-backups")?;
	let backup = backups.join(uuid::Uuid::new_v4().to_string());
	fs::create_dir_all(&backup).map_err(|e| e.to_string())?;
	for (path, old, _) in &changes {
		if let Some(bytes) = old { atomic_write(&backup.join(path.file_name().unwrap()), bytes)?; }
	}
	for (i, (path, _, bytes)) in changes.iter().enumerate() {
		if let Err(error) = atomic_write(path, bytes) {
			let mut rollback_failed = false;
			for (path, old, _) in &changes[..i] {
				rollback_failed |= match old { Some(bytes) => atomic_write(path, bytes), None => fs::remove_file(path).map_err(|e| e.to_string()) }.is_err();
			}
			return Err(format!("Worker configuration was not fully applied: {error}. Rollback {}. Originals: {}", if rollback_failed { "needs inspection" } else { "completed" }, backup.display()));
		}
	}
	Ok(format!("{} config file(s) prepared; originals backed up in {}", changes.len(), backup.display()))
}

#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn preparation_preserves_settings_and_recovery() {
		let temp = tempfile::tempdir().unwrap();
		let target = temp.path().join("worker"); fs::create_dir(&target).unwrap();
		let key = "test-crew-key-01234567890123456789";
		prepare(&target, None, Some(("127.0.0.1", 6969, key))).unwrap();
		let folder = target.join("monocle-client");
		let bytes = read(&folder.join("bots.nbt")).unwrap().unwrap();
		let mut root = decode(Some(&bytes)).unwrap();
		assert_eq!(root.get::<_, i8>("active").unwrap(), 1);
		assert_eq!(named(list(named(list(compound(&mut root, "settings").unwrap(), "groups").unwrap(), "General").unwrap(), "settings").unwrap(), "mode").unwrap().get::<_, &str>("value").unwrap(), "Worker");
		assert!(prepare(&target, None, Some(("127.0.0.1", 6969, key))).unwrap().contains("already current"));
		fs::write(folder.join("swarm-crew-recovery.json"), b"{}").unwrap();
		assert!(prepare(&target, None, Some(("127.0.0.2", 1234, key))).unwrap().contains("recovery retained"));
		assert_eq!(read(&folder.join("bots.nbt")).unwrap().unwrap(), bytes);
	}
	#[test]
	fn source_changes_settings_only_and_invalid_source_does_not_write() {
		let mut source = NbtCompound::new();
		let module = named(list(&mut source, "modules").unwrap(), "highway-builder").unwrap();
		module.insert("active", 1_i8); module.insert("settings", NbtCompound::new());
		let mut target = NbtCompound::new();
		copy_module_settings(&mut target, &source).unwrap();
		let module = named(list(&mut target, "modules").unwrap(), "highway-builder").unwrap();
		assert!(!module.contains_key("active"));
		let temp = tempfile::tempdir().unwrap();
		let worker = temp.path().join("worker"); fs::create_dir(&worker).unwrap();
		let template = temp.path().join("source"); fs::create_dir_all(template.join("monocle-client")).unwrap();
		fs::write(template.join("monocle-client/modules.nbt"), b"invalid").unwrap();
		assert!(prepare(&worker, Some(&template), Some(("127.0.0.1", 6969, "test-crew-key-01234567890123456789"))).is_err());
		assert!(!worker.join("monocle-client/bots.nbt").exists());
	}
}
