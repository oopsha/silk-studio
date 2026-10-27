use std::{
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use serde::Deserialize;
use zip::ZipArchive;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpringProjectRequest {
    pub source: String,
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
pub async fn get_spring_initializr_metadata(source: String, boot_version: Option<String>) -> Result<serde_json::Value, String> {
    let (snapshot, fetched_at) = if source == "online" {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().map_err(|error| error.to_string())?;
        let response = client.get("https://start.spring.io/metadata/client")
            .header("Accept", "application/vnd.initializr.v2.3+json")
            .send().await.map_err(|error| format!("Spring Initializr 메타데이터를 가져오지 못했습니다: {error}"))?;
        if !response.status().is_success() { return Err(format!("Spring Initializr 메타데이터 요청 오류: {}", response.status())); }
        let capabilities: serde_json::Value = response.json().await.map_err(|error| format!("Spring Initializr 메타데이터를 해석하지 못했습니다: {error}"))?;
        let version = boot_version.clone().filter(|value| !value.is_empty()).or_else(|| capabilities.pointer("/bootVersion/default").and_then(serde_json::Value::as_str).map(str::to_string)).ok_or_else(|| "Spring Initializr 기본 Boot 버전이 없습니다.".to_string())?;
        let deps_response = client.get("https://start.spring.io/dependencies").query(&[("bootVersion", version.as_str())])
            .header("Accept", "application/vnd.initializr.v2.3+json")
            .send().await.map_err(|error| format!("Spring Initializr 의존성 목록을 가져오지 못했습니다: {error}"))?;
        if !deps_response.status().is_success() { return Err(format!("Spring Initializr 의존성 요청 오류: {}", deps_response.status())); }
        let deps: serde_json::Value = deps_response.json().await.map_err(|error| format!("Spring Initializr 의존성 목록을 해석하지 못했습니다: {error}"))?;
        let result = filter_capabilities(capabilities, deps.get("dependencies").cloned().unwrap_or(serde_json::Value::Null))?;
        return Ok(serde_json::json!({ "capabilities": result, "fetchedAt": null }));
    } else if source == "offline" {
        let snapshot: serde_json::Value = serde_json::from_str(include_str!("../resources/spring-initializr-metadata.json"))
        .map_err(|error| format!("내장 Spring Initializr 메타데이터를 읽지 못했습니다: {error}"))?;
        (snapshot.clone(), snapshot.get("fetchedAt").cloned().unwrap_or(serde_json::Value::Null))
    } else { return Err("알 수 없는 Spring Initializr 모드입니다.".into()); };
    let capabilities = snapshot.get("capabilities")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "내장 메타데이터에 capabilities가 없습니다.".to_string())?;
    let default_version = capabilities.get("bootVersion")
        .and_then(|value| value.get("default"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "내장 메타데이터에 기본 Spring Boot 버전이 없습니다.".to_string())?;
    let version = boot_version.filter(|value| !value.is_empty()).unwrap_or_else(|| default_version.to_string());
    let dependencies_by_version = snapshot.get("dependenciesByBootVersion")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "내장 메타데이터에 버전별 의존성 목록이 없습니다.".to_string())?;
    let available_dependencies = dependencies_by_version.get(&version)
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| format!("내장 메타데이터에 Spring Boot {version} 의존성 목록이 없습니다."))?;

    let mut metadata = serde_json::Value::Object(capabilities.clone());
    let groups = metadata.get_mut("dependencies")
        .and_then(|value| value.get_mut("values"))
        .and_then(serde_json::Value::as_array_mut)
        .ok_or_else(|| "내장 메타데이터의 의존성 그룹 형식이 올바르지 않습니다.".to_string())?;
    groups.retain_mut(|group| {
        let Some(values) = group.get_mut("values").and_then(serde_json::Value::as_array_mut) else {
            return false;
        };
        values.retain(|dependency| dependency.get("id")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|id| available_dependencies.contains_key(id)));
        !values.is_empty()
    });
    Ok(serde_json::json!({ "capabilities": metadata, "fetchedAt": fetched_at }))
}

fn filter_capabilities(mut capabilities: serde_json::Value, dependencies: serde_json::Value) -> Result<serde_json::Value, String> {
    let available = dependencies.as_object().ok_or_else(|| "Spring Initializr 의존성 응답 형식이 올바르지 않습니다.".to_string())?;
    let groups = capabilities.get_mut("dependencies").and_then(|value| value.get_mut("values")).and_then(serde_json::Value::as_array_mut).ok_or_else(|| "Spring Initializr 의존성 그룹 형식이 올바르지 않습니다.".to_string())?;
    groups.retain_mut(|group| {
        let Some(values) = group.get_mut("values").and_then(serde_json::Value::as_array_mut) else { return false; };
        values.retain(|dependency| dependency.get("id").and_then(serde_json::Value::as_str).is_some_and(|id| available.contains_key(id)));
        !values.is_empty()
    });
    Ok(capabilities)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpringProjectResult {
    pub path: String,
    pub source: String,
}

#[tauri::command]
pub async fn create_spring_project(request: SpringProjectRequest) -> Result<SpringProjectResult, String> {
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
    if !valid_coordinate(&request.group_id) || !valid_coordinate(&request.artifact_id) || !valid_package_name(&request.package_name) {
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
        ("configurationFileFormat", request.configuration_file_format.as_str()),
        ("dependencies", dependencies.as_str()),
    ];

    if request.source == "offline" {
        if request.language != "java" || request.packaging != "jar" || request.configuration_file_format != "properties"
            || !matches!(request.type_id.as_str(), "maven-project" | "gradle-project") {
            return Err("현재 오프라인 생성기는 Java, Jar, Properties와 기본 Maven/Gradle 형식만 지원합니다.".into());
        }
        if !matches!(request.java_version.as_str(), "17" | "21" | "25") { return Err("현재 선택한 Java 버전은 오프라인 템플릿에서 지원하지 않습니다.".into()); }
        create_offline_project(&request, &destination)?;
        return Ok(SpringProjectResult { path: destination.to_string_lossy().into_owned(), source: "offline".into() });
    }
    if request.source != "online" { return Err("알 수 없는 Spring Initializr 모드입니다.".into()); }

    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build().map_err(|error| error.to_string())?
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
    Ok(SpringProjectResult { path: destination.to_string_lossy().into_owned(), source: "initializr".into() })
}

fn create_offline_project(request: &SpringProjectRequest, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination)
        .map_err(|error| format!("프로젝트 폴더를 만들지 못했습니다: {error}"))?;
    let result = (|| {
        let deps = offline_dependencies(&request.dependencies)?;
        let main_dir = destination.join("src/main/java").join(request.package_name.replace('.', "/"));
        fs::create_dir_all(&main_dir).map_err(|error| error.to_string())?;
        let class_prefix = request.project_name.split(|c: char| !c.is_ascii_alphanumeric())
            .filter(|part| !part.is_empty())
            .map(|part| { let mut chars = part.chars(); chars.next().map(|first| first.to_ascii_uppercase().to_string() + chars.as_str()).unwrap_or_default() })
            .collect::<String>();
        let class_prefix = if class_prefix.is_empty() { "" } else { &class_prefix };
        let java = format!("package {};\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n@SpringBootApplication\npublic class {}Application {{\n    public static void main(String[] args) {{\n        SpringApplication.run({}Application.class, args);\n    }}\n}}\n", request.package_name, class_prefix, class_prefix);
        fs::write(main_dir.join(format!("{}Application.java", class_prefix)), java).map_err(|error| error.to_string())?;
        fs::create_dir_all(destination.join("src/main/resources")).map_err(|error| error.to_string())?;
        fs::write(destination.join("src/main/resources/application.properties"), "\n").map_err(|error| error.to_string())?;
        if request.build_tool == "maven" {
            let dependencies = deps.iter().map(|(group, artifact, scope)| format!("        <dependency><groupId>{group}</groupId><artifactId>{artifact}</artifactId>{scope}</dependency>\n")).collect::<String>();
            let xml = format!("<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\"><modelVersion>4.0.0</modelVersion><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>{}</version><relativePath/></parent><groupId>{}</groupId><artifactId>{}</artifactId><version>0.0.1-SNAPSHOT</version><name>{}</name><properties><java.version>{}</java.version></properties><dependencies>\n{}    </dependencies><build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>\n", request.boot_version, request.group_id, request.artifact_id, request.project_name, request.java_version, dependencies);
            fs::write(destination.join("pom.xml"), xml).map_err(|error| error.to_string())?;
        } else {
            let dependencies = deps.iter().map(|(group, artifact, _)| format!("    implementation '{group}:{artifact}'\n")).collect::<String>();
            let gradle = format!("plugins {{\n    id 'java'\n    id 'org.springframework.boot' version '{}'\n    id 'io.spring.dependency-management' version '1.1.7'\n}}\ngroup = '{}'\nversion = '0.0.1-SNAPSHOT'\n\njava {{ toolchain {{ languageVersion = JavaLanguageVersion.of({}) }} }}\nrepositories {{ mavenCentral() }}\ndependencies {{\n{}    testImplementation 'org.springframework.boot:spring-boot-starter-test'\n    testRuntimeOnly 'org.junit.platform:junit-platform-launcher'\n}}\n", request.boot_version, request.group_id, request.java_version, dependencies);
            fs::write(destination.join("build.gradle"), gradle).map_err(|error| error.to_string())?;
            fs::write(destination.join("settings.gradle"), format!("rootProject.name = '{}'\n", request.project_name)).map_err(|error| error.to_string())?;
        }
        fs::write(destination.join(".gitignore"), "/target/\n/build/\n/.gradle/\n*.class\n").map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(destination);
        return Err(format!("오프라인 프로젝트 생성에 실패했습니다: {error}"));
    }
    Ok(())
}

fn valid_coordinate(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
}

fn valid_package_name(value: &str) -> bool {
    !value.is_empty() && value.split('.').all(|part| {
        let mut chars = part.chars();
        matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
    })
}

fn offline_dependencies(ids: &[String]) -> Result<Vec<(&'static str, &'static str, &'static str)>, String> {
    let mut result = Vec::new();
    for id in ids {
        let entry = match id.as_str() {
            "web" => ("org.springframework.boot", "spring-boot-starter-web", ""),
            "data-jpa" => ("org.springframework.boot", "spring-boot-starter-data-jpa", ""),
            "security" => ("org.springframework.boot", "spring-boot-starter-security", ""),
            "validation" => ("org.springframework.boot", "spring-boot-starter-validation", ""),
            "lombok" => ("org.projectlombok", "lombok", "<optional>true</optional>"),
            "devtools" => ("org.springframework.boot", "spring-boot-devtools", "<optional>true</optional>"),
            "h2" => ("com.h2database", "h2", "<scope>runtime</scope>"),
            "mysql" => ("com.mysql", "mysql-connector-j", "<scope>runtime</scope>"),
            "postgresql" => ("org.postgresql", "postgresql", "<scope>runtime</scope>"),
            _ => return Err(format!("오프라인 모드에서 지원하지 않는 의존성입니다: {id}")),
        };
        result.push(entry);
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
