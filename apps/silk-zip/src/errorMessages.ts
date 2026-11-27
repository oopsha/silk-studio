import { getActiveLocale } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";

/**
 * The native code (Rust and the 7-Zip bridge) reports errors in Korean, and the front end tells
 * cancel and password errors apart by those words. They are therefore translated only where they
 * are shown. `{}` stands for a value; a value that is itself a message is translated too.
 */
const MESSAGES: Record<string, string> = {
  // Creating archives
  "UTF-8로 표현할 수 없는 파일 이름은 압축할 수 없습니다.": "File names that cannot be written in UTF-8 cannot be compressed.",
  "압축할 항목이 최대 한도(10만 개)를 초과합니다.": "There are more items than the limit (100,000).",
  "압축 항목 이름이 중복됩니다: {}": "Duplicate item name in the archive: {}",
  "폴더 이름을 읽을 수 없습니다.": "Could not read the folder name.",
  "압축 작업이 취소되었습니다.": "Compression was cancelled.",
  "폴더를 읽지 못했습니다: {} ({})": "Could not read the folder: {} ({})",
  "심볼릭 링크는 현재 압축할 수 없습니다: {}": "Symbolic links cannot be compressed yet: {}",
  "심볼릭 링크는 현재 압축할 수 없습니다.": "Symbolic links cannot be compressed yet.",
  "파일 이름을 읽을 수 없습니다.": "Could not read the file name.",
  "일반 파일과 폴더만 압축할 수 있습니다: {}": "Only regular files and folders can be compressed: {}",
  "일반 파일과 폴더만 압축할 수 있습니다.": "Only regular files and folders can be compressed.",
  "압축할 파일을 추가하세요.": "Add files to compress.",
  "압축할 파일이 없습니다.": "There are no files to compress.",
  "입력 항목에 접근할 수 없습니다: {} ({})": "Cannot access the input item: {} ({})",
  "저장 파일 이름이 올바르지 않습니다.": "The output file name is not valid.",
  "임시 압축 파일 이름을 만들지 못했습니다.": "Could not make a temporary archive name.",
  "분할 압축 임시 폴더를 만들지 못했습니다: {}": "Could not create the temporary folder for volumes: {}",
  "분할 압축 임시 폴더 이름을 만들지 못했습니다.": "Could not name the temporary folder for volumes.",
  "압축 파일을 저장하지 못했습니다: {}": "Could not save the archive: {}",
  "저장 위치에 같은 이름의 파일이 아닌 항목이 있습니다.": "Something other than a file already has this name at the destination.",
  "기존 압축 파일을 안전하게 보관할 임시 경로를 만들지 못했습니다.": "Could not make a temporary path to keep the existing archive safe.",
  "기존 파일을 보관하지 못했습니다: {}": "Could not keep the existing file: {}",
  "새 압축 파일 저장에 실패했고 기존 파일 복원도 실패했습니다: {}; {}": "Saving the new archive failed, and so did restoring the old file: {}; {}",
  "저장 파일 이름을 UTF-8로 처리할 수 없습니다.": "The output file name cannot be handled as UTF-8.",
  "분할 압축 저장 경로에 파일이 아닌 항목이 있습니다: {}": "Something other than a file is in the way of a volume: {}",
  "분할 압축 엔진이 최종 ZIP 파일을 만들지 않았습니다.": "The split engine did not produce the final ZIP file.",
  "분할 압축 파일 크기를 계산하지 못했습니다.": "Could not calculate the size of the volumes.",
  "기존 분할 파일 이름을 읽지 못했습니다.": "Could not read the name of an existing volume.",
  "기존 분할 압축 파일을 보관하지 못했습니다: {}": "Could not keep the existing volumes: {}",
  "새 분할 압축 파일 저장 실패 후 기존 파일 복원도 실패했습니다: {}; {}": "Saving the new volumes failed, and so did restoring the old files: {}; {}",
  "분할 압축 파일을 저장하지 못했습니다: {}": "Could not save the volumes: {}",
  "PKWARE 분할 ZIP의 디스크 수 한도를 초과했습니다.": "The split ZIP exceeds the PKWARE disk limit.",
  "분할 ZIP 디스크 번호가 너무 큽니다.": "A split ZIP disk number is too large.",
  "분할 ZIP 출력이 닫혔습니다.": "The split ZIP output was closed.",
  "분할 ZIP 출력이 비어 있습니다.": "The split ZIP output is empty.",
  "7-Zip SDK가 만든 ZIP의 끝 레코드를 찾지 못했습니다.": "Could not find the end record of the ZIP made by the 7-Zip SDK.",
  "저장 경로를 UTF-8로 처리할 수 없습니다.": "The output path cannot be handled as UTF-8.",
  "저장 경로가 올바르지 않습니다.": "The output path is not valid.",
  "입력 경로를 UTF-8로 처리할 수 없습니다.": "The input path cannot be handled as UTF-8.",
  "입력 경로가 올바르지 않습니다.": "The input path is not valid.",
  "압축 항목 이름이 올바르지 않습니다.": "An item name is not valid.",
  "암호에 지원하지 않는 문자가 포함되어 있습니다.": "The password contains unsupported characters.",
  "압축 항목 수가 너무 많습니다.": "There are too many items.",
  "7-Zip SDK에서 {} 생성에 실패했습니다 (HRESULT {}).": "The 7-Zip SDK failed to create {} (HRESULT {}).",
  "압축 중 파일 크기가 변경되었습니다: {}": "A file changed size while being compressed: {}",
  "분할 파일이 너무 많습니다. 분할 크기를 늘려 주세요.": "Too many volumes. Increase the volume size.",
  "기존 파일 이름을 읽지 못했습니다.": "Could not read the name of the existing file.",
  "분할 파일 이름을 읽지 못했습니다.": "Could not read a volume name.",
  "압축 내부 경로가 올바르지 않습니다.": "A path inside the archive is not valid.",
  "압축 항목이 중복되거나 최대 개수를 초과합니다: {}": "Duplicate item, or too many items: {}",
  "파일 아래에 항목을 추가할 수 없습니다.": "Items cannot be added under a file.",
  "GZ 압축에 실패했습니다 (HRESULT {}).": "GZ compression failed (HRESULT {}).",
  "지원하지 않는 압축 수준입니다.": "Unsupported compression level.",
  "{} 형식은 암호를 지원하지 않습니다.": "The {} format does not support passwords.",
  "{} 형식은 분할 압축을 지원하지 않습니다.": "The {} format does not support split volumes.",
  "분할 크기는 64KB 이상이어야 합니다.": "The volume size must be at least 64 KB.",
  "{} 파일의 확장자는 .{}이어야 합니다.": "A {} file must have the extension .{}.",
  "저장할 폴더가 존재하지 않습니다.": "The destination folder does not exist.",
  "{}는 파일 하나만 압축할 수 있습니다. 여러 파일이나 폴더는 TGZ 또는 TAR을 사용하세요.": "{} can compress only a single file. Use TGZ or TAR for several files or folders.",
  "압축 파일을 입력 파일과 같은 경로에 저장할 수 없습니다.": "The archive cannot be saved over an input file.",
  "분할 압축 파일이 입력 파일과 같은 경로입니다: {}": "A volume would overwrite an input file: {}",
  "압축할 전체 파일 크기가 너무 큽니다.": "The total size to compress is too large.",

  // Reading, extracting, testing, changing and repairing
  "압축 파일을 찾을 수 없습니다.": "The archive was not found.",
  "압축 파일 경로를 UTF-8로 처리할 수 없습니다.": "The archive path cannot be handled as UTF-8.",
  "압축 파일 경로가 올바르지 않습니다.": "The archive path is not valid.",
  "암호가 올바르지 않습니다.": "Wrong password.",
  "압축 풀기가 취소되었습니다.": "Extraction was cancelled.",
  "암호가 필요한 압축 파일입니다.": "This archive needs a password.",
  "선택한 항목을 압축 파일에서 찾지 못했습니다.": "The selected items were not found in the archive.",
  "지원하지 않는 형식이거나 손상된 압축 파일입니다.": "Unsupported format, or the archive is damaged.",
  "압축 풀기에 실패했습니다 (HRESULT {}).": "Extraction failed (HRESULT {}).",
  "지원하지 않는 압축 방식입니다.": "Unsupported compression method.",
  "압축 파일이 손상되었습니다.": "The archive is damaged.",
  "암호가 올바르지 않거나 파일이 손상되었습니다.": "Wrong password, or the file is damaged.",
  "압축 파일의 일부 조각이 없습니다.": "Some volumes of the archive are missing.",
  "압축 파일에 저장 폴더 밖을 가리키는 안전하지 않은 경로가 있습니다.": "The archive has an unsafe path that points outside the destination folder.",
  "파일을 만들지 못했습니다. 경로와 권한을 확인하세요.": "Could not create a file. Check the path and permissions.",
  "일부 항목을 처리하지 못했습니다.": "Some items could not be processed.",
  "{}개 항목에 문제가 있습니다. {}": "{} item(s) have problems. {}",
  "{}개 항목을 풀지 못했습니다. {}": "{} item(s) could not be extracted. {}",
  "선택한 항목 경로가 올바르지 않습니다.": "A selected item path is not valid.",
  "저장 위치에 같은 이름의 파일이 있습니다.": "A file with the same name is at the destination.",
  "저장 폴더를 만들지 못했습니다: {}": "Could not create the destination folder: {}",
  "같은 이름의 폴더가 있습니다: {}": "A folder with the same name exists: {}",
  "{}가 취소되었습니다.": "Cancelled: {}",
  "이 형식은 압축 파일 안의 변경을 지원하지 않습니다. (zip, 7z, tar만 가능)": "This format cannot be changed in place. (Only zip, 7z and tar can.)",
  "변경할 항목을 압축 파일에서 찾지 못했습니다.": "The items to change were not found in the archive.",
  "같은 이름의 항목이 이미 있습니다.": "An item with this name already exists.",
  "{}에 실패했습니다 (HRESULT {}).": "{} failed (HRESULT {}).",
  "원본 압축 파일을 교체하지 못했습니다: {}": "Could not replace the original archive: {}",
  "압축 파일을 교체하지 못했습니다: {}": "Could not replace the archive: {}",
  "변경할 항목이 없습니다.": "There is nothing to change.",
  "항목 경로가 올바르지 않습니다.": "An item path is not valid.",
  "새 이름이 올바르지 않습니다.": "The new name is not valid.",
  "파일을 읽지 못했습니다: {}: {}": "Could not read the file: {}: {}",
  "항목 이름이 올바르지 않습니다.": "An item name is not valid.",
  "임시 파일 경로를 UTF-8로 처리할 수 없습니다.": "The temporary file path cannot be handled as UTF-8.",
  "임시 파일 경로가 올바르지 않습니다.": "The temporary file path is not valid.",
  "변경": "Change",
  "손상된 원본과 같은 위치에는 저장할 수 없습니다.": "It cannot be saved over the damaged original.",
  "저장할 파일 이름이 올바르지 않습니다.": "The file name to save is not valid.",
  "지원하지 않는 형식": "Unsupported format",
  "압축 파일의 구조를 인식하지 못해 복구할 수 없습니다.": "The archive structure was not recognised, so it cannot be repaired.",
  "복구할 수 있는 항목이 없습니다.": "There is nothing that can be recovered.",
  "기존 파일을 바꾸지 못했습니다: {}": "Could not replace the existing file: {}",
  "복구한 파일을 저장하지 못했습니다: {}": "Could not save the repaired file: {}",

  // Listing
  "압축 파일을 읽지 못했습니다.": "Could not read the archive.",
  "압축 파일 이름을 읽지 못했습니다.": "Could not read the archive name.",
  "분할 ZIP 항목 이름을 읽지 못했습니다.": "Could not read an item name in the split ZIP.",
  "분할 ZIP 파일 이름이 올바른 UTF-8이 아닙니다.": "A split ZIP file name is not valid UTF-8.",
  "이 파일은 현재 목록 표시 한도(10만 항목 또는 이름 합계 16MB)를 초과합니다.": "This file exceeds the listing limit (100,000 items or 16 MB of names).",
  "잘못된 압축 파일 경로입니다.": "Invalid archive path.",
  "분할 ZIP을 열거나 목록을 읽지 못했습니다. 모든 .z01, .z02 등의 조각이 같은 폴더에 있는지 확인하세요. (오류 코드 {})": "Could not open or list the split ZIP. Check that every volume (.z01, .z02, …) is in the same folder. (error code {})",
  "압축 엔진을 초기화하지 못했습니다.": "Could not start the archive engine.",
  "잘못된 파일 경로입니다.": "Invalid file path.",
  "압축 파일에서 반복적인 읽기 경고가 발생했습니다.": "The archive keeps reporting read warnings.",
  "파일 이름을 UTF-8로 읽지 못했습니다.": "Could not read a file name as UTF-8.",

  // The app itself
  "압축 파일을 읽는 중 오류가 발생했습니다.": "An error occurred while reading the archive.",
  "압축 풀기 작업 식별자가 없습니다.": "The extraction has no task id.",
  "작업 상태를 읽지 못했습니다.": "Could not read the task state.",
  "이미 실행 중인 작업입니다.": "This task is already running.",
  "압축 풀기를 실행하지 못했습니다.": "Could not start the extraction.",
  "테스트 작업 식별자가 없습니다.": "The test has no task id.",
  "압축 파일 테스트를 실행하지 못했습니다.": "Could not start the test.",
  "변경 작업 식별자가 없습니다.": "The change has no task id.",
  "변경을 실행하지 못했습니다.": "Could not apply the changes.",
  "복구 작업 식별자가 없습니다.": "The repair has no task id.",
  "복구를 실행하지 못했습니다.": "Could not start the repair.",
  "압축 작업 식별자가 없습니다.": "The compression has no task id.",
  "압축 작업 상태를 읽지 못했습니다.": "Could not read the compression state.",
  "이미 실행 중인 압축 작업입니다.": "This compression is already running.",
  "압축 작업을 실행하지 못했습니다.": "Could not start the compression.",
  "폴더를 열지 못했습니다: {}": "Could not open the folder: {}",
  "분할 압축 파일은 다른 이름으로 저장할 수 없습니다.": "Split archives cannot be saved under another name.",
  "원본과 같은 위치에는 저장할 수 없습니다.": "It cannot be saved over the original.",
  "저장하지 못했습니다: {}": "Could not save: {}",
  "저장을 실행하지 못했습니다.": "Could not start saving.",
  "실행 파일 경로를 찾지 못했습니다: {}": "Could not find the program path: {}",
  "관리자 권한으로 새 창을 열지 못했습니다: {}": "Could not open an administrator window: {}",
  "관리자 권한 새 창은 Windows에서만 지원합니다.": "Administrator windows are supported only on Windows.",
  "Store 버전에서는 관리자 권한 새 창을 지원하지 않습니다.": "The Store version cannot open administrator windows.",
  "열 수 없는 주소입니다.": "This address cannot be opened.",
  "브라우저를 열지 못했습니다: {}": "Could not open the browser: {}",
  "새 창을 열지 못했습니다: {}": "Could not open a new window: {}",
  "설치 위치를 확인하지 못했습니다: {}": "Could not determine the install location: {}",
  "압축 파일이 저장된 폴더를 찾을 수 없습니다.": "The folder of the archive was not found.",
  "임시 폴더를 만들지 못했습니다: {}": "Could not create a temporary folder: {}",
  "복사할 수 없는 위치입니다.": "This location cannot be copied to.",
  "복사할 항목을 읽지 못했습니다: {}": "Could not read the items to copy: {}",
  "복사할 항목이 없습니다.": "There is nothing to copy.",
  "클립보드를 열지 못했습니다.": "Could not open the clipboard.",
  "클립보드 메모리를 확보하지 못했습니다.": "Could not allocate clipboard memory.",
  "클립보드에 복사하지 못했습니다.": "Could not copy to the clipboard.",
  "클립보드를 사용하지 못했습니다: {}": "Could not use the clipboard: {}",
  "이 운영체제에서는 파일 클립보드를 지원하지 않습니다.": "The file clipboard is not supported on this operating system.",
  "항목 이름을 읽을 수 없습니다.": "Could not read an item name.",
  "최대 10만 개 항목까지 추가할 수 있습니다.": "Up to 100,000 items can be added.",
  "일반 파일과 폴더만 추가할 수 있습니다.": "Only regular files and folders can be added.",
  "추가할 항목을 읽지 못했습니다.": "Could not read the items to add.",
  "파일 연결을 저장하지 못했습니다: {}": "Could not save the file associations: {}",
  "Windows 설정을 열지 못했습니다.": "Could not open Windows Settings.",
  "폴더 선택창을 열지 못했습니다.": "Could not open the folder dialog.",
  "폴더 선택창을 열지 못했습니다: {}": "Could not open the folder dialog: {}",
  "이 운영체제에서는 지원하지 않습니다.": "Not supported on this operating system.",
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Messages with values, the most specific (longest fixed text) first. */
const PATTERNS = Object.entries(MESSAGES)
  .filter(([korean]) => korean.includes("{}"))
  .sort(([left], [right]) => right.replace(/\{\}/g, "").length - left.replace(/\{\}/g, "").length)
  .map(([korean, english]) => ({ match: new RegExp(`^${korean.split("{}").map(escape).join("([\\s\\S]*?)")}$`), english }));

function translate(message: string): string {
  const exact = MESSAGES[message];
  if (exact) return exact;
  for (const { match, english } of PATTERNS) {
    const values = match.exec(message);
    if (!values) continue;
    let index = 1;
    return english.replace(/\{\}/g, () => translate(values[index++] ?? ""));
  }
  return message;
}

/** An error from the native code in the display language; unknown text is shown as it is. */
export function trError(message: string): string {
  if (getActiveLocale() !== "en") return message;
  // "archive.zip: message" is used when several archives are handled.
  const named = /^([^:\n]+\.[A-Za-z0-9]+): ([\s\S]+)$/.exec(message);
  if (named) return `${named[1]}: ${translate(named[2])}`;
  return translate(message.replace(/^Error: /, ""));
}
