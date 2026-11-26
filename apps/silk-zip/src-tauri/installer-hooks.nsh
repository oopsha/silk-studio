; Explorer context menu (HKCU, written by the app itself) and its extension DLL.
; The DLL is not a Tauri resource: tauri-build would copy it into target\release at every app
; build, where Explorer keeps it locked. It is built by `pnpm tauri:build` and added here instead.
!define SILK_ZIP_SHELL_DLL "silk_zip_shell.dll"
; Expanded here, where __FILEDIR__ is this file's folder (inside a macro it would be the installer's).
!define SILK_ZIP_SHELL_SOURCE "${__FILEDIR__}\..\..\..\target\release\${SILK_ZIP_SHELL_DLL}"

; Explorer keeps a loaded extension open, so it cannot be overwritten or deleted. A loaded file
; can still be renamed: move it aside and delete it at the next restart.
!macro SILK_ZIP_SHELL_MOVE_ASIDE
  IfFileExists "$INSTDIR\${SILK_ZIP_SHELL_DLL}" 0 +6
    Delete "$INSTDIR\${SILK_ZIP_SHELL_DLL}"
    IfFileExists "$INSTDIR\${SILK_ZIP_SHELL_DLL}" 0 +4
      GetTempFileName $0 "$INSTDIR"
      Delete $0
      Rename "$INSTDIR\${SILK_ZIP_SHELL_DLL}" $0
      Delete /REBOOTOK $0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro SILK_ZIP_SHELL_MOVE_ASIDE
  SetOutPath "$INSTDIR"
  File "${SILK_ZIP_SHELL_SOURCE}"
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --register-shell'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister-shell'
  !insertmacro SILK_ZIP_SHELL_MOVE_ASIDE
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The folder goes once the moved-aside DLL has been deleted at restart.
  RMDir /REBOOTOK "$INSTDIR"
!macroend
