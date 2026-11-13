#[tauri::command]
pub async fn archive_list(path: String) -> Result<silk_archive::ArchiveListing, String> {
    tauri::async_runtime::spawn_blocking(move || {
        silk_archive::list_archive(std::path::Path::new(&path))
    })
    .await
    .map_err(|_| "압축 파일을 읽는 중 오류가 발생했습니다.".to_string())?
}
