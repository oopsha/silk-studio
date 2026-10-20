use std::{
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
};

use serde::Deserialize;
use zip::ZipArchive;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpringProjectRequest {
    pub parent_path: String,
    pub project_name: String,
    pub build_tool: String,
    pub group_id: String,
    pub artifact_id: String,
    pub package_name: String,
    pub java_version: String,
    pub dependencies: Vec<String>,
}

#[tauri::command]
pub async fn create_spring_project(request: SpringProjectRequest) -> Result<String, String> {
    let project_name = request.project_name.trim();
    if project_name.is_empty()
        || project_name == "."
        || project_name == ".."
        || project_name
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || "-_".contains(c)))
    {
        return Err("프로젝트 이름은 영문, 숫자, 하이픈, 밑줄만 사용할 수 있습니다.".into());
    }
    if !matches!(request.build_tool.as_str(), "maven" | "gradle") {
        return Err("지원하지 않는 빌드 도구입니다.".into());
    }
    if !matches!(request.java_version.as_str(), "17" | "21" | "25") {
        return Err("지원하지 않는 Java 버전입니다.".into());
    }

    let parent = PathBuf::from(&request.parent_path);
    if !parent.is_dir() {
        return Err("선택한 상위 폴더를 찾을 수 없습니다.".into());
    }
    let destination = parent.join(project_name);
    if destination.exists() {
        return Err("같은 이름의 폴더가 이미 있습니다.".into());
    }

    let project_type = if request.build_tool == "maven" {
        "maven-project"
    } else {
        "gradle-project"
    };
    let dependencies = request.dependencies.join(",");
    let form = [
        ("type", project_type),
        ("language", "java"),
        ("groupId", request.group_id.trim()),
        ("artifactId", request.artifact_id.trim()),
        ("name", project_name),
        ("packageName", request.package_name.trim()),
        ("packaging", "jar"),
        ("javaVersion", request.java_version.as_str()),
        ("dependencies", dependencies.as_str()),
    ];

    let response = reqwest::Client::new()
        .post("https://start.spring.io/starter.zip")
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("Spring Initializr에 연결하지 못했습니다: {error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("응답을 읽지 못했습니다: {error}"))?;
    if !status.is_success() {
        let body = String::from_utf8_lossy(&bytes);
        return Err(format!(
            "Spring Initializr 오류 ({}): {}",
            status,
            body.chars().take(500).collect::<String>()
        ));
    }

    if let Err(error) = extract_project(bytes.to_vec(), &destination) {
        let _ = fs::remove_dir_all(&destination);
        return Err(error);
    }
    Ok(destination.to_string_lossy().into_owned())
}

fn extract_project(bytes: Vec<u8>, destination: &Path) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("프로젝트 압축을 읽지 못했습니다: {error}"))?;
    fs::create_dir(destination)
        .map_err(|error| format!("프로젝트 폴더를 만들지 못했습니다: {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("압축 파일 항목을 읽지 못했습니다: {error}"))?;
        let Some(relative) = entry.enclosed_name().map(Path::to_path_buf) else {
            continue;
        };
        if relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        {
            continue;
        }
        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output)
                .map_err(|error| format!("폴더를 만들지 못했습니다: {error}"))?;
        } else {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("폴더를 만들지 못했습니다: {error}"))?;
            }
            let mut file = fs::File::create(&output)
                .map_err(|error| format!("파일을 만들지 못했습니다: {error}"))?;
            let mut contents = Vec::new();
            entry
                .read_to_end(&mut contents)
                .map_err(|error| format!("압축 파일을 풀지 못했습니다: {error}"))?;
            use std::io::Write;
            file.write_all(&contents)
                .map_err(|error| format!("파일을 기록하지 못했습니다: {error}"))?;
        }
    }
    Ok(())
}
