use std::{
    fs,
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use serde::Deserialize;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpringProjectRequest {
    pub source: String,
    pub indent_size: usize,
    pub parent_path: String,
    pub project_name: String,
    pub build_tool: String,
    pub type_id: String,
    pub group_id: String,
    pub artifact_id: String,
    pub package_name: String,
    pub java_version: String,
    pub boot_version: String,
    pub language: String,
    pub packaging: String,
    pub configuration_file_format: String,
    pub dependencies: Vec<String>,
}

#[tauri::command]
pub async fn get_spring_initializr_metadata(
    source: String,
    boot_version: Option<String>,
) -> Result<serde_json::Value, String> {
    if !matches!(source.as_str(), "online" | "offline") {
        return Err("알 수 없는 Spring Initializr 모드입니다.".into());
    }
    let snapshot: serde_json::Value =
        serde_json::from_str(include_str!("../resources/spring-initializr-metadata.json"))
            .map_err(|error| {
                format!("내장 Spring Initializr 메타데이터를 읽지 못했습니다: {error}")
            })?;
    let fetched_at = snapshot
        .get("fetchedAt")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let capabilities = snapshot
        .get("capabilities")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "내장 메타데이터에 capabilities가 없습니다.".to_string())?;
    let default_version = capabilities
        .get("bootVersion")
        .and_then(|value| value.get("default"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "내장 메타데이터에 기본 Spring Boot 버전이 없습니다.".to_string())?;
    let version = boot_version
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_version.to_string());
    let dependencies_by_version = snapshot
        .get("dependenciesByBootVersion")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "내장 메타데이터에 버전별 의존성 목록이 없습니다.".to_string())?;
    let available_dependencies = dependencies_by_version
        .get(&version)
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| {
            format!("내장 메타데이터에 Spring Boot {version} 의존성 목록이 없습니다.")
        })?;

    let mut metadata = serde_json::Value::Object(capabilities.clone());
    if source == "offline" {
        retain_option_ids(&mut metadata, "type", &["maven-project", "gradle-project"]);
        retain_option_ids(&mut metadata, "language", &["java"]);
        retain_option_ids(&mut metadata, "packaging", &["jar"]);
        retain_option_ids(&mut metadata, "configurationFileFormat", &["properties"]);
    }
    let groups = metadata
        .get_mut("dependencies")
        .and_then(|value| value.get_mut("values"))
        .and_then(serde_json::Value::as_array_mut)
        .ok_or_else(|| "내장 메타데이터의 의존성 그룹 형식이 올바르지 않습니다.".to_string())?;
    groups.retain_mut(|group| {
        let Some(values) = group
            .get_mut("values")
            .and_then(serde_json::Value::as_array_mut)
        else {
            return false;
        };
        values.retain(|dependency| {
            dependency
                .get("id")
                .and_then(serde_json::Value::as_str)
                .and_then(|id| available_dependencies.get(id))
                .is_some_and(|dependency| {
                    source == "online" || is_offline_dependency_supported(dependency)
                })
        });
        !values.is_empty()
    });
    Ok(serde_json::json!({ "capabilities": metadata, "fetchedAt": fetched_at }))
}

fn retain_option_ids(metadata: &mut serde_json::Value, key: &str, allowed: &[&str]) {
    if let Some(values) = metadata
        .get_mut(key)
        .and_then(|value| value.get_mut("values"))
        .and_then(serde_json::Value::as_array_mut)
    {
        values.retain(|option| {
            option
                .get("id")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|id| allowed.contains(&id))
        });
    }
}

fn is_offline_dependency_supported(dependency: &serde_json::Value) -> bool {
    let supported_scope = matches!(
        dependency.get("scope").and_then(serde_json::Value::as_str),
        Some("compile" | "runtime" | "test" | "annotationProcessor")
    );
    let has_external_bom = dependency.get("bom").is_some_and(|bom| !bom.is_null());
    supported_scope && !has_external_bom
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpringProjectResult {
    pub path: String,
    pub source: String,
}

#[tauri::command]
pub async fn create_spring_project(
    request: SpringProjectRequest,
) -> Result<SpringProjectResult, String> {
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
    if !valid_coordinate(&request.group_id)
        || !valid_coordinate(&request.artifact_id)
        || !valid_package_name(&request.package_name)
    {
        return Err("Group, Artifact, Package name 형식을 확인해 주세요.".into());
    }
    if !matches!(request.build_tool.as_str(), "maven" | "gradle") {
        return Err("지원하지 않는 빌드 도구입니다.".into());
    }

    let parent = PathBuf::from(&request.parent_path);
    if !parent.is_dir() {
        return Err("선택한 상위 폴더를 찾을 수 없습니다.".into());
    }
    let destination = parent.join(project_name);
    if destination.exists() {
        return Err("같은 이름의 폴더가 이미 있습니다.".into());
    }

    let dependencies = request.dependencies.join(",");
    let form = [
        ("type", request.type_id.as_str()),
        ("language", request.language.as_str()),
        ("groupId", request.group_id.trim()),
        ("artifactId", request.artifact_id.trim()),
        ("name", project_name),
        ("packageName", request.package_name.trim()),
        ("packaging", request.packaging.as_str()),
        ("javaVersion", request.java_version.as_str()),
        ("bootVersion", request.boot_version.as_str()),
        (
            "configurationFileFormat",
            request.configuration_file_format.as_str(),
        ),
        ("dependencies", dependencies.as_str()),
    ];

    if request.source == "offline" {
        if request.language != "java"
            || request.packaging != "jar"
            || request.configuration_file_format != "properties"
            || !matches!(request.type_id.as_str(), "maven-project" | "gradle-project")
        {
            return Err("오프라인 생성은 Java, Jar, Properties와 Maven 또는 Gradle Groovy 형식만 지원합니다.".into());
        }
        if !(1..=8).contains(&request.indent_size) {
            return Err("오프라인 들여쓰기는 1~8칸으로 설정해 주세요.".into());
        }
        let archive = create_offline_archive(&request)?;
        if let Err(error) = extract_project(archive, &destination) {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
        return Ok(SpringProjectResult {
            path: destination.to_string_lossy().into_owned(),
            source: "offline".into(),
        });
    }
    if request.source != "online" {
        return Err("알 수 없는 Spring Initializr 모드입니다.".into());
    }

    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .post("https://start.spring.io/starter.zip")
        .form(&form)
        .send()
        .await;
    let response = response.map_err(|error| format!("Spring Initializr에 연결하지 못했습니다. 온라인 모드를 계속 사용하려면 네트워크를 확인해 주세요: {error}"))?;
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
    Ok(SpringProjectResult {
        path: destination.to_string_lossy().into_owned(),
        source: "initializr".into(),
    })
}

fn create_offline_archive(request: &SpringProjectRequest) -> Result<Vec<u8>, String> {
    let deps = offline_dependencies(&request.boot_version, &request.dependencies)?;
    let class_name = application_class_name(&request.project_name);
    let indent_1 = " ".repeat(request.indent_size);
    let indent_2 = " ".repeat(request.indent_size * 2);
    let indent_3 = " ".repeat(request.indent_size * 3);
    let indent_4 = " ".repeat(request.indent_size * 4);
    let source_path = format!(
        "src/main/java/{}/{}Application.java",
        request.package_name.replace('.', "/"),
        class_name
    );
    let source = format!(
        "package {package};\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n@SpringBootApplication\npublic class {class_name}Application {{\n{indent_1}public static void main(String[] args) {{\n{indent_2}SpringApplication.run({class_name}Application.class, args);\n{indent_1}}}\n}}\n",
        package = request.package_name,
        class_name = class_name,
        indent_1 = indent_1,
        indent_2 = indent_2,
    );
    let build_files = if request.build_tool == "maven" {
        let dependencies = deps.iter().map(|(group, artifact, scope)| {
            let scope = maven_dependency_scope(scope, &indent_3);
            format!("{indent_2}<dependency>\n{indent_3}<groupId>{group}</groupId>\n{indent_3}<artifactId>{artifact}</artifactId>{scope}\n{indent_2}</dependency>\n")
        }).collect::<String>();
        let pom = format!("<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n{indent_1}<modelVersion>4.0.0</modelVersion>\n{indent_1}<parent>\n{indent_2}<groupId>org.springframework.boot</groupId>\n{indent_2}<artifactId>spring-boot-starter-parent</artifactId>\n{indent_2}<version>{boot_version}</version>\n{indent_2}<relativePath/>\n{indent_1}</parent>\n{indent_1}<groupId>{group_id}</groupId>\n{indent_1}<artifactId>{artifact_id}</artifactId>\n{indent_1}<version>0.0.1-SNAPSHOT</version>\n{indent_1}<name>{project_name}</name>\n{indent_1}<properties>\n{indent_2}<java.version>{java_version}</java.version>\n{indent_1}</properties>\n{indent_1}<dependencies>\n{dependencies}{indent_1}</dependencies>\n{indent_1}<build>\n{indent_2}<plugins>\n{indent_3}<plugin>\n{indent_4}<groupId>org.springframework.boot</groupId>\n{indent_4}<artifactId>spring-boot-maven-plugin</artifactId>\n{indent_3}</plugin>\n{indent_2}</plugins>\n{indent_1}</build>\n</project>\n", boot_version=request.boot_version, group_id=request.group_id, artifact_id=request.artifact_id, project_name=request.project_name, java_version=request.java_version, dependencies=dependencies, indent_1=indent_1, indent_2=indent_2, indent_3=indent_3, indent_4=indent_4);
        vec![("pom.xml".to_string(), pom)]
    } else {
        let dependencies = deps
            .iter()
            .map(|(group, artifact, scope)| {
                format!(
                    "{indent_1}{} '{}:{}'\n",
                    gradle_dependency_scope(scope),
                    group,
                    artifact
                )
            })
            .collect::<String>();
        let build = format!("plugins {{\n{indent_1}id 'java'\n{indent_1}id 'org.springframework.boot' version '{boot_version}'\n{indent_1}id 'io.spring.dependency-management' version '1.1.7'\n}}\ngroup = '{group_id}'\nversion = '0.0.1-SNAPSHOT'\n\njava {{\n{indent_1}toolchain {{\n{indent_2}languageVersion = JavaLanguageVersion.of({java_version})\n{indent_1}}}\n}}\n\nrepositories {{\n{indent_1}mavenCentral()\n}}\n\ndependencies {{\n{dependencies}{indent_1}testImplementation 'org.springframework.boot:spring-boot-starter-test'\n{indent_1}testRuntimeOnly 'org.junit.platform:junit-platform-launcher'\n}}\n", boot_version=request.boot_version, group_id=request.group_id, java_version=request.java_version, dependencies=dependencies, indent_1=indent_1, indent_2=indent_2);
        vec![
            ("build.gradle".to_string(), build),
            (
                "settings.gradle".to_string(),
                format!("rootProject.name = '{}'\n", request.project_name),
            ),
        ]
    };

    let mut files = vec![
        (source_path, source),
        ("src/main/resources/application.properties".to_string(), String::new()),
            (".editorconfig".to_string(), format!("root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\nindent_style = space\nindent_size = {}\n", request.indent_size)),
        (".gitignore".to_string(), "/target/\n/build/\n/.gradle/\n*.class\n".to_string()),
        ("README.md".to_string(), format!("# {}\n\nSpring Boot {} project.\n", request.project_name, request.boot_version)),
    ];
    files.extend(build_files);

    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (path, contents) in files {
        writer
            .start_file(path, options)
            .map_err(|error| format!("오프라인 ZIP 항목을 만들지 못했습니다: {error}"))?;
        writer
            .write_all(contents.as_bytes())
            .map_err(|error| format!("오프라인 ZIP 파일을 기록하지 못했습니다: {error}"))?;
    }
    writer
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| format!("오프라인 ZIP을 마무리하지 못했습니다: {error}"))
}

fn application_class_name(project_name: &str) -> String {
    let mut name = project_name
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<String>();
    if name.is_empty() {
        name.push_str("Application");
    }
    if name
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_digit())
    {
        name.insert_str(0, "App");
    }
    name
}

fn maven_dependency_scope(scope: &str, indentation: &str) -> String {
    match scope {
        "runtime" => format!("\n{indentation}<scope>runtime</scope>"),
        "test" => format!("\n{indentation}<scope>test</scope>"),
        "annotationProcessor" => format!("\n{indentation}<scope>provided</scope>"),
        _ => String::new(),
    }
}

fn gradle_dependency_scope(scope: &str) -> &'static str {
    match scope {
        "runtime" => "runtimeOnly",
        "test" => "testImplementation",
        "annotationProcessor" => "annotationProcessor",
        _ => "implementation",
    }
}

fn valid_coordinate(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
}

fn valid_package_name(value: &str) -> bool {
    !value.is_empty()
        && value.split('.').all(|part| {
            let mut chars = part.chars();
            matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$')
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
        })
}

fn offline_dependencies(
    boot_version: &str,
    ids: &[String],
) -> Result<Vec<(String, String, String)>, String> {
    let snapshot: serde_json::Value =
        serde_json::from_str(include_str!("../resources/spring-initializr-metadata.json"))
            .map_err(|error| {
                format!("내장 Spring Initializr 메타데이터를 읽지 못했습니다: {error}")
            })?;
    let available = snapshot
        .pointer("/dependenciesByBootVersion")
        .and_then(|versions| versions.get(boot_version))
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| {
            format!("내장 메타데이터에 Spring Boot {boot_version} 의존성 목록이 없습니다.")
        })?;
    let mut result = Vec::new();
    for id in ids {
        let entry = available.get(id).ok_or_else(|| {
            format!("Spring Boot {boot_version}에서 사용할 수 없는 의존성입니다: {id}")
        })?;
        if !is_offline_dependency_supported(entry) {
            return Err(format!(
                "현재 오프라인 템플릿에서 지원하지 않는 의존성입니다: {id}"
            ));
        }
        let group = entry
            .get("groupId")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("의존성 groupId가 없습니다: {id}"))?;
        let artifact = entry
            .get("artifactId")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("의존성 artifactId가 없습니다: {id}"))?;
        let scope = entry
            .get("scope")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("의존성 scope가 없습니다: {id}"))?;
        result.push((group.to_string(), artifact.to_string(), scope.to_string()));
    }
    Ok(result)
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
        let Some(relative) = entry.enclosed_name() else {
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
