; Explorer context menu (HKCU, written by the app itself).
!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --register-shell'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister-shell'
!macroend
